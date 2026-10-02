# Authentication, RBAC, Customer & Order API

## Production setup

Set these Render API environment variables before using the dashboard:

- `AUTH_SECRET`: random secret with at least 32 characters. This signs 8-hour bearer tokens.
- `BOOTSTRAP_SECRET`: random one-time setup secret with at least 24 characters.

Do not commit either value or send them through chat.

## One-time Owner bootstrap

`POST /api/v1/auth/bootstrap`

```json
{
  "email": "owner@example.com",
  "display_name": "Owner",
  "password": "minimum 12 characters",
  "bootstrap_secret": "the Render BOOTSTRAP_SECRET"
}
```

The endpoint succeeds only when the database has no user records. It creates an `OWNER` account, assigns all permissions, and returns an access token. After successful bootstrap, use normal login. If the database already has a user, bootstrap returns `409`.

## Login

`POST /api/v1/auth/login`

```json
{
  "email": "owner@example.com",
  "password": "minimum 12 characters"
}
```

Use the returned token on protected routes:

```text
Authorization: Bearer <access_token>
```

`GET /api/v1/auth/me` returns the current user, role codes, and permission codes.

## Roles

| Role | Intended access |
|---|---|
| `OWNER` | Full business, payment, delivery, product, reports, and user control |
| `OPERATIONS_MANAGER` | Operations, payment verification, delivery, products, reports |
| `CS_AGENT` | Customer creation, order creation, customer/order read, product read, warranty handling |
| `FULFILMENT_AGENT` | Order read, product read, paid delivery queue, delivery update |

Delivery and payment verification are separate high-risk permissions. A CS agent does not receive either permission by default.

## Staff provisioning

Only a user with `users.manage` can call these endpoints:

- `GET /api/v1/users` — list active and invited staff without password data.
- `POST /api/v1/users` — create an active role-scoped staff account.

Create a CS account:

```json
{
  "email": "cs@example.com",
  "display_name": "CS Agent 1",
  "password": "minimum 12 characters",
  "role_code": "CS_AGENT"
}
```

Allowed staff roles from this endpoint are `OPERATIONS_MANAGER`, `CS_AGENT`, and `FULFILMENT_AGENT`. Owner accounts are intentionally excluded from ordinary staff provisioning. The action writes an audit-log entry and never returns a password hash.

## Customer API

- `GET /api/v1/customers?q=&limit=50` — customer list/search; requires `customers.read`.
- `POST /api/v1/customers` — create a customer; requires `customers.create`.
- `GET /api/v1/customers/:id` — read a customer; requires `customers.read`.

Create body:

```json
{
  "display_name": "Customer Name",
  "customer_type": "PERSONAL",
  "country_code": "MM",
  "language_code": "my",
  "phone": "+959xxxxxxxxx",
  "email": "customer@example.com",
  "source_code": "FACEBOOK_MESSENGER",
  "marketing_consent": false
}
```

## Order API

- `GET /api/v1/orders?status=&limit=50` — list orders; requires `orders.read`.
- `POST /api/v1/orders` — create a payment-pending order; requires `orders.create`.
- `GET /api/v1/orders/:id` — read an order and its line items; requires `orders.read`.

Create body:

```json
{
  "customer_id": "customer-uuid",
  "items": [
    { "product_variation_id": "variation-uuid", "quantity": 1 }
  ],
  "payment_method_code": "KBZPAY",
  "discount_amount": 0
}
```

The API validates customer existence, active payment method, product availability, positive approved retail prices, and discount limits. It snapshots product/variation names and prices into `order_items` and creates the order as:

```text
status          = PAYMENT_PENDING
payment_status  = PENDING
delivery_status = PENDING
```

No delivery endpoint is included in this slice. Payment verification and delivery must remain explicit Owner/Operations actions in the next workflow implementation.

## Security notes

- Passwords are stored as salted `scrypt` hashes.
- Tokens are signed with HMAC-SHA256 and expire after 8 hours.
- Every protected request rechecks the active user and current database permissions.
- Customer and order endpoints return business records only to authenticated users with the required permission.
- Do not store provider passwords, OTPs, recovery codes, or shared account credentials in this system.

## Payment proof workflow

### Private storage prerequisites

Proof files are stored in a private S3-compatible object store. The API stores only file metadata and a private object key in PostgreSQL; it never returns a public file URL.

Configure these API environment variables in Render before uploading real proofs:

- `STORAGE_ENDPOINT`
- `STORAGE_BUCKET`
- `STORAGE_REGION` (default `auto`)
- `STORAGE_FORCE_PATH_STYLE` (`false` for most providers)
- `STORAGE_ACCESS_KEY`
- `STORAGE_SECRET_KEY`

Accepted files are JPG, PNG, WEBP, and PDF up to 10 MB. The API records a SHA-256 checksum, MIME type, byte size, original filename, uploader, and timestamp.

### Upload payment proof

`POST /api/v1/payment-proofs`

Requires `payments.read` and must be sent as `multipart/form-data` with:

| Field | Required | Description |
|---|---:|---|
| `order_id` | Yes | Existing order UUID |
| `payment_method_code` | Yes | `KBZPAY`, `WAVEPAY`, or `AYAPAY` |
| `claimed_amount` | Yes | Must match the order total in this MVP |
| `transaction_reference` | Yes | Bank/wallet transaction reference |
| `transaction_at` | No | ISO-8601 timestamp |
| `file` | Yes | JPG, PNG, WEBP, or PDF proof |

After upload:

```text
payment_proof.status = PROOF_RECEIVED
order.status         = PAYMENT_PROOF_RECEIVED
order.payment_status = PROOF_RECEIVED
order.delivery_status = PENDING
```

### Owner review queue

`GET /api/v1/payment-proofs?status=PROOF_RECEIVED&limit=50`

Requires `payments.read`. The response includes customer/order context and file metadata, but not the private storage key.

### Owner verify

`POST /api/v1/payment-proofs/:id/verify`

Requires `payments.verify`.

```json
{
  "review_note": "Amount and transaction reference checked"
}
```

The transaction atomically:

1. Marks the proof `VERIFIED`.
2. Creates or updates the order payment record as `VERIFIED`.
3. Changes the order to `DELIVERY_PENDING`.
4. Changes the order payment status to `VERIFIED`.
5. Creates a `PENDING` manual digital-delivery queue record.
6. Writes an audit-log entry.

### Owner reject

`POST /api/v1/payment-proofs/:id/reject`

Requires `payments.verify`.

```json
{
  "rejection_reason": "Transaction reference does not match the submitted proof",
  "review_note": "Ask customer to resend a clear screenshot"
}
```

The transaction marks the proof and payment record `REJECTED`, returns the order to `PAYMENT_PENDING`, keeps delivery blocked, and writes an audit-log entry. A proof cannot be reviewed twice after it reaches `VERIFIED` or `REJECTED`.

## CS frontend workspace

The authenticated dashboard now includes a **Customers & Order Creation** workspace:

- Search customers by name, phone, email, or public code.
- Open customer detail with phone, email, language, customer type, and order count.
- Create a new Personal, Business, or Reseller customer.
- Select an active product/access variation and quantity.
- Select KBZPay, WavePay, or AYA Pay.
- Create a `PAYMENT_PENDING` order.
- View that customer's recent purchase history.

The UI does not expose payment verification to CS. Every new order visibly states that delivery remains blocked until Owner verifies the payment proof.
