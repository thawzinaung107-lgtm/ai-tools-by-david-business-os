import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import { pool } from './db.js';

const app = Fastify({ logger: true });

await app.register(helmet);
await app.register(sensible);
await app.register(cors, {
  origin: process.env.CORS_ORIGIN?.split(',').map((value) => value.trim()) ?? false,
  credentials: true,
});

app.get('/health', async () => ({
  status: 'ok',
  service: 'ai-tools-by-david-api',
  timestamp: new Date().toISOString(),
}));

app.get('/ready', async (_request, reply) => {
  try {
    await pool.query('select 1');
    return { status: 'ready', database: 'ok' };
  } catch (error) {
    app.log.error(error);
    return reply.code(503).send({ status: 'not_ready', database: 'unavailable' });
  }
});

app.get('/api/v1/meta', async () => ({
  data: {
    store_name: 'AI Tools By David Digital Store',
    api_version: 'v1',
    mode: process.env.NODE_ENV ?? 'development',
  },
}));

app.get('/api/v1/dashboard/summary', async () => {
  const result = await pool.query(`
    select
      (select count(*)::int from leads where deleted_at is null and stage = 'NEW_INQUIRY') as new_inquiries,
      (select count(*)::int from payment_proofs where status in ('PROOF_RECEIVED', 'NEED_MORE_INFORMATION')) as payment_proofs_waiting,
      (select count(*)::int from orders where deleted_at is null and payment_status = 'VERIFIED' and delivery_status in ('PENDING', 'PROCESSING')) as delivery_pending,
      (select count(*)::int from warranty_tickets where status in ('OPEN', 'IN_PROGRESS')) as open_warranty_cases,
      (select count(*)::int from orders where deleted_at is null and created_at >= current_date) as orders_today,
      (select coalesce(sum(total_amount), 0)::numeric from orders where deleted_at is null and payment_status = 'VERIFIED' and created_at >= current_date) as verified_revenue_today
  `);

  return { data: result.rows[0] };
});

app.get('/api/v1/products', async (request) => {
  const query = request.query as { status?: string };
  const values: string[] = [];
  const statusFilter = query.status ? `and p.status = $1` : '';
  if (query.status) values.push(query.status);

  const result = await pool.query(
    `
      select p.id, p.master_sku, p.name, p.short_description, p.status,
             p.access_model, p.delivery_method, p.warranty_summary,
             coalesce(json_agg(json_build_object(
               'id', v.id,
               'sku', v.sku,
               'name', v.name,
               'access_period_months', v.access_period_months,
               'retail_price', v.retail_price,
               'reseller_price', v.reseller_price,
               'currency_code', v.currency_code,
               'warranty_days', v.warranty_days,
               'status', v.status
             ) order by v.name) filter (where v.id is not null), '[]') as variations
      from products p
      left join product_variations v on v.product_id = p.id and v.deleted_at is null
      where p.deleted_at is null ${statusFilter}
      group by p.id
      order by p.name
    `,
    values,
  );
  return { data: result.rows };
});

const port = Number(process.env.PORT ?? 10000);
const host = '0.0.0.0';

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
