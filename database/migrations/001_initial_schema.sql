create extension if not exists citext;

create type user_status as enum ('ACTIVE', 'INVITED', 'SUSPENDED', 'DISABLED');
create type customer_type as enum ('PERSONAL', 'BUSINESS', 'RESELLER');
create type product_status as enum ('DRAFT', 'ACTIVE', 'PAUSED', 'SOLD_OUT', 'ARCHIVED');
create type order_status as enum ('DRAFT', 'CONFIRMED', 'PAYMENT_PENDING', 'PAYMENT_PROOF_RECEIVED', 'PAYMENT_VERIFICATION', 'PAID', 'DELIVERY_PENDING', 'DELIVERED', 'CUSTOMER_CONFIRMED', 'CANCELLED');
create type payment_status as enum ('PENDING', 'PROOF_RECEIVED', 'VERIFIED', 'REJECTED', 'NEED_MORE_INFORMATION', 'REFUND_REVIEW', 'REFUNDED');
create type delivery_status as enum ('PENDING', 'PROCESSING', 'DELIVERED', 'CUSTOMER_CONFIRMED', 'FAILED');

create table users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  display_name varchar(120) not null,
  password_hash text not null default 'MVP_AUTH_PLACEHOLDER',
  status user_status not null default 'INVITED',
  mfa_enabled boolean not null default false,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table roles (
  id uuid primary key default gen_random_uuid(),
  code varchar(50) not null unique,
  name varchar(100) not null,
  description text,
  is_system_role boolean not null default true,
  created_at timestamptz not null default now()
);

create table permissions (
  id uuid primary key default gen_random_uuid(),
  code varchar(100) not null unique,
  description text not null,
  risk_level varchar(20) not null default 'LOW',
  created_at timestamptz not null default now()
);

create table user_roles (
  user_id uuid not null references users(id),
  role_id uuid not null references roles(id),
  assigned_by uuid references users(id),
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create table role_permissions (
  role_id uuid not null references roles(id),
  permission_id uuid not null references permissions(id),
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  public_code varchar(30) not null unique,
  display_name varchar(160) not null,
  customer_type customer_type not null default 'PERSONAL',
  country_code char(2),
  language_code varchar(10) not null default 'my',
  phone varchar(30),
  email citext,
  assigned_user_id uuid references users(id),
  source_code varchar(50),
  marketing_consent boolean not null default false,
  last_contact_at timestamptz,
  last_purchase_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table products (
  id uuid primary key default gen_random_uuid(),
  master_sku varchar(80) not null unique,
  name varchar(160) not null,
  short_description text not null,
  status product_status not null default 'DRAFT',
  access_model varchar(50) not null,
  delivery_method varchar(50) not null,
  provider_terms_summary text not null,
  warranty_summary text not null,
  renewal_available boolean not null default false,
  owner_approved_at timestamptz,
  owner_approved_by uuid references users(id),
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table product_variations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  sku varchar(100) not null unique,
  name varchar(120) not null,
  access_period_months numeric(6,2),
  status product_status not null default 'PAUSED',
  currency_code char(3) not null default 'MMK',
  retail_price numeric(18,2) not null default 0 check (retail_price >= 0),
  reseller_price numeric(18,2) check (reseller_price is null or reseller_price >= 0),
  cost_price numeric(18,2) check (cost_price is null or cost_price >= 0),
  warranty_days integer not null default 0 check (warranty_days >= 0),
  available_capacity integer check (available_capacity is null or available_capacity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table payment_methods (
  id uuid primary key default gen_random_uuid(),
  code varchar(50) not null unique,
  display_name varchar(100) not null,
  account_display_name varchar(160) not null,
  account_identifier_masked varchar(80),
  instruction_template text not null,
  status varchar(20) not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table leads (
  id uuid primary key default gen_random_uuid(),
  public_code varchar(30) not null unique,
  customer_id uuid not null references customers(id),
  product_id uuid references products(id),
  access_period varchar(50),
  use_type customer_type,
  stage varchar(40) not null default 'NEW_INQUIRY',
  assigned_user_id uuid references users(id),
  next_follow_up_at timestamptz,
  lost_reason varchar(100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  public_code varchar(30) not null unique,
  customer_id uuid not null references customers(id),
  lead_id uuid references leads(id),
  status order_status not null default 'DRAFT',
  currency_code char(3) not null default 'MMK',
  subtotal_amount numeric(18,2) not null default 0 check (subtotal_amount >= 0),
  discount_amount numeric(18,2) not null default 0 check (discount_amount >= 0),
  total_amount numeric(18,2) not null default 0 check (total_amount >= 0),
  payment_method_id uuid references payment_methods(id),
  payment_status payment_status not null default 'PENDING',
  delivery_status delivery_status not null default 'PENDING',
  assigned_cs_id uuid references users(id),
  access_start_date date,
  expiry_date date,
  warranty_end_date date,
  customer_confirmation_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason varchar(255),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (total_amount = subtotal_amount - discount_amount),
  check (expiry_date is null or access_start_date is not null),
  check (status <> 'PAID' or payment_status = 'VERIFIED'),
  check (delivery_status <> 'DELIVERED' or payment_status = 'VERIFIED')
);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  product_id uuid not null references products(id),
  product_variation_id uuid not null references product_variations(id),
  product_name_snapshot varchar(160) not null,
  variation_name_snapshot varchar(120) not null,
  sku_snapshot varchar(100) not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(18,2) not null check (unit_price >= 0),
  discount_amount numeric(18,2) not null default 0 check (discount_amount >= 0),
  line_total numeric(18,2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create table payment_proofs (
  id uuid primary key default gen_random_uuid(),
  public_code varchar(30) not null unique,
  order_id uuid not null references orders(id),
  payment_method_id uuid not null references payment_methods(id),
  claimed_amount numeric(18,2) not null check (claimed_amount > 0),
  transaction_reference varchar(160) not null,
  transaction_at timestamptz,
  status payment_status not null default 'PROOF_RECEIVED',
  submitted_by uuid references users(id),
  verified_by uuid references users(id),
  verified_at timestamptz,
  rejection_reason varchar(255),
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(payment_method_id, transaction_reference)
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders(id),
  payment_proof_id uuid references payment_proofs(id),
  status payment_status not null default 'PENDING',
  amount_received numeric(18,2) check (amount_received is null or amount_received >= 0),
  currency_code char(3) not null default 'MMK',
  verified_by uuid references users(id),
  verified_at timestamptz,
  rejection_reason varchar(255),
  refund_amount numeric(18,2) check (refund_amount is null or refund_amount >= 0),
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table deliveries (
  id uuid primary key default gen_random_uuid(),
  public_code varchar(30) not null unique,
  order_id uuid not null references orders(id),
  status delivery_status not null default 'PENDING',
  method varchar(50) not null,
  delivered_by uuid references users(id),
  delivered_at timestamptz,
  access_start_date date,
  expiry_date date,
  delivery_reference text,
  customer_confirmed_at timestamptz,
  failure_reason varchar(255),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table warranty_tickets (
  id uuid primary key default gen_random_uuid(),
  public_code varchar(30) not null unique,
  customer_id uuid not null references customers(id),
  order_id uuid not null references orders(id),
  type varchar(40) not null,
  status varchar(30) not null default 'OPEN',
  subject varchar(200) not null,
  description text not null,
  assigned_to uuid references users(id),
  resolution text,
  resolution_approved_by uuid references users(id),
  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table renewal_tasks (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  order_id uuid not null references orders(id),
  due_at timestamptz not null,
  reminder_type varchar(30) not null,
  status varchar(20) not null default 'PENDING',
  assigned_to uuid references users(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id, reminder_type)
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references users(id),
  actor_type varchar(20) not null default 'USER',
  action varchar(80) not null,
  entity_type varchar(80),
  entity_id uuid,
  before_json jsonb,
  after_json jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index customers_assigned_idx on customers(assigned_user_id, customer_type) where deleted_at is null;
create index leads_followup_idx on leads(next_follow_up_at, stage) where deleted_at is null;
create index orders_queue_idx on orders(payment_status, delivery_status, created_at desc) where deleted_at is null;
create index orders_customer_idx on orders(customer_id, created_at desc) where deleted_at is null;
create index orders_expiry_idx on orders(expiry_date) where expiry_date is not null and deleted_at is null;
create index payment_proofs_queue_idx on payment_proofs(status, created_at desc);
create index tickets_queue_idx on warranty_tickets(status, assigned_to, created_at desc);
create index audit_entity_idx on audit_logs(entity_type, entity_id, created_at desc);

insert into roles(code, name, description) values
  ('OWNER', 'Owner', 'Full business and security control'),
  ('OPERATIONS_MANAGER', 'Operations Manager', 'Payment and operations review'),
  ('CS_AGENT', 'Customer Service Agent', 'Inbox, order entry, proof upload, verified delivery'),
  ('FULFILMENT_AGENT', 'Fulfilment Agent', 'Paid delivery queue only')
on conflict (code) do nothing;

insert into payment_methods(code, display_name, account_display_name, account_identifier_masked, instruction_template)
values
  ('KBZPAY', 'KBZPay', 'Set approved account before activation', 'not-configured', 'Owner must configure the approved KBZPay account.'),
  ('WAVEPAY', 'WavePay', 'Set approved account before activation', 'not-configured', 'Owner must configure the approved WavePay account.'),
  ('AYAPAY', 'AYA Pay', 'Set approved account before activation', 'not-configured', 'Owner must configure the approved AYA Pay account.')
on conflict (code) do nothing;
create extension if not exists citext;
create extension if not exists pgcrypto;
