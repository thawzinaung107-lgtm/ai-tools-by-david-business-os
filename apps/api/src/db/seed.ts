import 'dotenv/config';
import { pool } from '../db.js';

const products = [
  ['GEMINI-PRO', 'Gemini Pro'],
  ['CAPCUT-PRO', 'CapCut Pro'],
  ['ADOBE-CC', 'Adobe Creative Cloud'],
  ['CHATGPT-PLUS', 'ChatGPT Plus'],
  ['CLAUDE', 'Claude'],
] as const;

for (const [sku, name] of products) {
  const product = await pool.query(
    `insert into products (master_sku, name, short_description, status, access_model, delivery_method, provider_terms_summary, warranty_summary)
     values ($1, $2, $3, 'DRAFT', 'MANUAL', 'MANUAL_DIGITAL', $4, $5)
     on conflict (master_sku) do update set name = excluded.name
     returning id`,
    [sku, name, `${name} digital product offer`, 'Confirm current provider terms before sale.', 'Product-specific warranty terms apply.'],
  );

  const productId = product.rows[0].id;
  for (const [period, months] of [['1M', 1], ['12M', 12]] as const) {
    const variationSku = `${sku}-${period}`;
    await pool.query(
      `insert into product_variations (product_id, sku, name, access_period_months, status, currency_code, retail_price, warranty_days)
       values ($1, $2, $3, $4, 'PAUSED', 'MMK', 0, 0)
       on conflict (sku) do nothing`,
      [productId, variationSku, period === '1M' ? '1 Month' : '12 Months', months],
    );
  }
}

console.log('Seeded initial product catalog in PAUSED state. Set approved prices before activating.');
await pool.end();
