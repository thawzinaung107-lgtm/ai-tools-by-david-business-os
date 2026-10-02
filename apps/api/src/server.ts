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

app.get('/api/v1/products', async () => {
  const result = await pool.query(`
    select p.id, p.master_sku, p.name, p.status,
           coalesce(json_agg(json_build_object(
             'id', v.id,
             'sku', v.sku,
             'name', v.name,
             'retail_price', v.retail_price,
             'currency_code', v.currency_code,
             'status', v.status
           ) order by v.name) filter (where v.id is not null), '[]') as variations
    from products p
    left join product_variations v on v.product_id = p.id and v.deleted_at is null
    where p.deleted_at is null
    group by p.id
    order by p.name
  `);
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
