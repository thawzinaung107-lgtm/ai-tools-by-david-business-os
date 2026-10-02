-- Demo-only pricing for end-to-end QA. Replace with Owner-approved commercial prices before launch.
with demo_prices(master_sku, period_sku, retail_price, reseller_price, cost_price, warranty_days) as (
  values
    ('GEMINI-PRO', '1M', 30000::numeric, 27000::numeric, 20000::numeric, 7),
    ('GEMINI-PRO', '12M', 300000::numeric, 270000::numeric, 200000::numeric, 30),
    ('CAPCUT-PRO', '1M', 5000::numeric, 4500::numeric, 3000::numeric, 7),
    ('CAPCUT-PRO', '12M', 50000::numeric, 45000::numeric, 30000::numeric, 30),
    ('ADOBE-CC', '1M', 15000::numeric, 13500::numeric, 10000::numeric, 7),
    ('ADOBE-CC', '12M', 150000::numeric, 135000::numeric, 100000::numeric, 30),
    ('CHATGPT-PLUS', '1M', 35000::numeric, 31500::numeric, 25000::numeric, 7),
    ('CHATGPT-PLUS', '12M', 350000::numeric, 315000::numeric, 250000::numeric, 30),
    ('CLAUDE', '1M', 30000::numeric, 27000::numeric, 20000::numeric, 7),
    ('CLAUDE', '12M', 300000::numeric, 270000::numeric, 200000::numeric, 30)
)
update product_variations v
set retail_price = d.retail_price,
    reseller_price = d.reseller_price,
    cost_price = d.cost_price,
    warranty_days = d.warranty_days,
    status = 'ACTIVE',
    updated_at = now()
from products p, demo_prices d
where v.product_id = p.id
  and p.master_sku = d.master_sku
  and v.sku = d.master_sku || '-' || d.period_sku
  and v.deleted_at is null;

update products p
set status = 'ACTIVE',
    owner_approved_at = coalesce(owner_approved_at, now()),
    owner_approved_by = coalesce(owner_approved_by, (select id from users where status = 'ACTIVE' order by created_at limit 1)),
    updated_at = now()
where p.master_sku in ('GEMINI-PRO', 'CAPCUT-PRO', 'ADOBE-CC', 'CHATGPT-PLUS', 'CLAUDE')
  and p.deleted_at is null;
