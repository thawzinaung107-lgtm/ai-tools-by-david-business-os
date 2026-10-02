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
