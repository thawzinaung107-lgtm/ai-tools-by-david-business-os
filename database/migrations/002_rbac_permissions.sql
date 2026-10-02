insert into permissions(code, description, risk_level)
values
  ('dashboard.read', 'View operational dashboard metrics', 'LOW'),
  ('customers.read', 'View customer records', 'LOW'),
  ('customers.create', 'Create customer records', 'MEDIUM'),
  ('orders.read', 'View order records', 'LOW'),
  ('orders.create', 'Create draft/payment-pending orders', 'MEDIUM'),
  ('orders.update', 'Update order workflow fields', 'MEDIUM'),
  ('payments.read', 'View payment proof records', 'LOW'),
  ('payments.verify', 'Verify or reject customer payments', 'HIGH'),
  ('delivery.read', 'View delivery queue', 'LOW'),
  ('delivery.update', 'Mark paid orders as delivered', 'HIGH'),
  ('products.read', 'View the product catalog', 'LOW'),
  ('products.manage', 'Create or change product catalog records', 'HIGH'),
  ('warranty.read', 'View warranty tickets', 'LOW'),
  ('warranty.manage', 'Manage warranty tickets and resolutions', 'MEDIUM'),
  ('reports.read', 'View business reports', 'LOW'),
  ('users.manage', 'Manage users, roles, and security settings', 'CRITICAL')
on conflict (code) do update set description = excluded.description, risk_level = excluded.risk_level;

with role_permission_codes(role_code, permission_code) as (
  values
    ('OWNER', 'dashboard.read'),
    ('OWNER', 'customers.read'),
    ('OWNER', 'customers.create'),
    ('OWNER', 'orders.read'),
    ('OWNER', 'orders.create'),
    ('OWNER', 'orders.update'),
    ('OWNER', 'payments.read'),
    ('OWNER', 'payments.verify'),
    ('OWNER', 'delivery.read'),
    ('OWNER', 'delivery.update'),
    ('OWNER', 'products.read'),
    ('OWNER', 'products.manage'),
    ('OWNER', 'warranty.read'),
    ('OWNER', 'warranty.manage'),
    ('OWNER', 'reports.read'),
    ('OWNER', 'users.manage'),
    ('OPERATIONS_MANAGER', 'dashboard.read'),
    ('OPERATIONS_MANAGER', 'customers.read'),
    ('OPERATIONS_MANAGER', 'customers.create'),
    ('OPERATIONS_MANAGER', 'orders.read'),
    ('OPERATIONS_MANAGER', 'orders.create'),
    ('OPERATIONS_MANAGER', 'orders.update'),
    ('OPERATIONS_MANAGER', 'payments.read'),
    ('OPERATIONS_MANAGER', 'payments.verify'),
    ('OPERATIONS_MANAGER', 'delivery.read'),
    ('OPERATIONS_MANAGER', 'delivery.update'),
    ('OPERATIONS_MANAGER', 'products.read'),
    ('OPERATIONS_MANAGER', 'products.manage'),
    ('OPERATIONS_MANAGER', 'warranty.read'),
    ('OPERATIONS_MANAGER', 'warranty.manage'),
    ('OPERATIONS_MANAGER', 'reports.read'),
    ('CS_AGENT', 'dashboard.read'),
    ('CS_AGENT', 'customers.read'),
    ('CS_AGENT', 'customers.create'),
    ('CS_AGENT', 'orders.read'),
    ('CS_AGENT', 'orders.create'),
    ('CS_AGENT', 'payments.read'),
    ('CS_AGENT', 'delivery.read'),
    ('CS_AGENT', 'products.read'),
    ('CS_AGENT', 'warranty.read'),
    ('CS_AGENT', 'warranty.manage'),
    ('FULFILMENT_AGENT', 'dashboard.read'),
    ('FULFILMENT_AGENT', 'orders.read'),
    ('FULFILMENT_AGENT', 'delivery.read'),
    ('FULFILMENT_AGENT', 'delivery.update'),
    ('FULFILMENT_AGENT', 'products.read')
)
insert into role_permissions(role_id, permission_id)
select r.id, p.id
from role_permission_codes rpc
join roles r on r.code = rpc.role_code
join permissions p on p.code = rpc.permission_code
on conflict (role_id, permission_id) do nothing;

create index if not exists user_roles_role_idx on user_roles(role_id, user_id);
create index if not exists permissions_code_idx on permissions(code);
