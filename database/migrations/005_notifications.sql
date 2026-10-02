alter table customers
  add column if not exists telegram_chat_id varchar(100),
  add column if not exists email_notifications_enabled boolean not null default true,
  add column if not exists telegram_notifications_enabled boolean not null default false;

create index if not exists customers_telegram_chat_idx on customers(telegram_chat_id) where telegram_chat_id is not null;

insert into permissions(code, description, risk_level)
values
  ('customers.update', 'Update customer contact and notification preferences', 'MEDIUM'),
  ('notifications.read', 'View notification outbox delivery status', 'LOW')
on conflict (code) do update set description = excluded.description, risk_level = excluded.risk_level;

with role_permission_codes(role_code, permission_code) as (
  values
    ('OWNER', 'customers.update'),
    ('OWNER', 'notifications.read'),
    ('OPERATIONS_MANAGER', 'customers.update'),
    ('OPERATIONS_MANAGER', 'notifications.read'),
    ('CS_AGENT', 'customers.update')
)
insert into role_permissions(role_id, permission_id)
select r.id, p.id
from role_permission_codes rpc
join roles r on r.code = rpc.role_code
join permissions p on p.code = rpc.permission_code
on conflict (role_id, permission_id) do nothing;

create table if not exists notification_outbox (
  id uuid primary key default gen_random_uuid(),
  idempotency_key varchar(255) not null unique,
  channel varchar(20) not null check (channel in ('EMAIL', 'TELEGRAM')),
  event_type varchar(60) not null,
  customer_id uuid not null references customers(id),
  order_id uuid references orders(id),
  recipient varchar(255) not null,
  subject varchar(255),
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  status varchar(20) not null default 'PENDING' check (status in ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 8 check (max_attempts > 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notification_outbox_queue_idx
  on notification_outbox(status, next_attempt_at, created_at);
create index if not exists notification_outbox_customer_idx
  on notification_outbox(customer_id, created_at desc);
