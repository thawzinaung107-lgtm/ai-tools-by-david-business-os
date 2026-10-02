import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import { z } from 'zod';
import { pool } from './db.js';
import {
  authenticateRequest,
  createAccessToken,
  hashPassword,
  loadAuthContext,
  publicUser,
  requirePermission,
  verifyBootstrapSecret,
  verifyPassword,
} from './auth.js';

const app = Fastify({ logger: true });

await app.register(helmet);
await app.register(sensible);
await app.register(cors, {
  origin: process.env.CORS_ORIGIN?.split(',').map((value) => value.trim()) ?? false,
  credentials: true,
});

const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

const bootstrapSchema = loginSchema.extend({
  display_name: z.string().trim().min(2).max(120),
  bootstrap_secret: z.string().min(1).max(200),
});

const customerSchema = z.object({
  display_name: z.string().trim().min(2).max(160),
  customer_type: z.enum(['PERSONAL', 'BUSINESS', 'RESELLER']).default('PERSONAL'),
  country_code: z.string().trim().length(2).toUpperCase().optional(),
  language_code: z.string().trim().min(2).max(10).default('my'),
  phone: z.string().trim().min(5).max(30).optional(),
  email: z.string().email().max(200).optional(),
  source_code: z.string().trim().max(50).optional(),
  marketing_consent: z.boolean().default(false),
});

const orderSchema = z.object({
  customer_id: z.string().uuid(),
  items: z.array(z.object({
    product_variation_id: z.string().uuid(),
    quantity: z.coerce.number().int().min(1).max(100),
  })).min(1).max(20),
  payment_method_code: z.string().trim().max(50).optional(),
  discount_amount: z.coerce.number().min(0).default(0),
});

function makeCode(prefix: string) {
  return `${prefix}-${randomBytes(5).toString('hex').toUpperCase()}`;
}

function sendValidationError(reply: { code: (status: number) => { send: (body: unknown) => unknown } }, parsed: { error: z.ZodError }) {
  return reply.code(400).send({
    error: 'Validation failed',
    details: parsed.error.flatten(),
  });
}

async function getOrder(orderId: string) {
  const result = await pool.query(`
    select o.id, o.public_code, o.status, o.currency_code, o.subtotal_amount,
           o.discount_amount, o.total_amount, o.payment_status, o.delivery_status,
           o.created_at, c.id as customer_id, c.public_code as customer_code,
           c.display_name as customer_name, c.phone as customer_phone,
           coalesce(json_agg(json_build_object(
             'id', oi.id,
             'product_id', oi.product_id,
             'variation_id', oi.product_variation_id,
             'product_name', oi.product_name_snapshot,
             'variation_name', oi.variation_name_snapshot,
             'sku', oi.sku_snapshot,
             'quantity', oi.quantity,
             'unit_price', oi.unit_price,
             'line_total', oi.line_total
           ) order by oi.created_at) filter (where oi.id is not null), '[]') as items
    from orders o
    join customers c on c.id = o.customer_id
    left join order_items oi on oi.order_id = o.id
    where o.id = $1 and o.deleted_at is null
    group by o.id, c.id
  `, [orderId]);
  return result.rows[0] ?? null;
}

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

app.post('/api/v1/auth/bootstrap', async (request, reply) => {
  const parsed = bootstrapSchema.safeParse(request.body);
  if (!parsed.success) return sendValidationError(reply, parsed);
  if (!verifyBootstrapSecret(parsed.data.bootstrap_secret)) {
    return reply.code(403).send({ error: 'Invalid bootstrap secret' });
  }

  const existing = await pool.query(`select count(*)::int as count from users where deleted_at is null`);
  if (existing.rows[0].count > 0) {
    return reply.code(409).send({ error: 'Bootstrap is already complete' });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const user = await client.query(`
      insert into users (email, display_name, password_hash, status)
      values ($1, $2, $3, 'ACTIVE')
      returning id, email::text, display_name
    `, [parsed.data.email.toLowerCase(), parsed.data.display_name, passwordHash]);
    await client.query(`
      insert into user_roles (user_id, role_id)
      select $1, id from roles where code = 'OWNER'
    `, [user.rows[0].id]);
    await client.query('commit');
    const context = await loadAuthContext(user.rows[0].id);
    if (!context) throw new Error('Owner bootstrap failed to load role context');
    return reply.code(201).send({ access_token: await createAccessToken(context.userId, context.email), user: publicUser(context) });
  } catch (error) {
    await client.query('rollback');
    if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'Email is already registered' });
    throw error;
  } finally {
    client.release();
  }
});

app.post('/api/v1/auth/login', async (request, reply) => {
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) return sendValidationError(reply, parsed);
  const result = await pool.query(`
    select id, email::text, password_hash
    from users
    where email = $1 and status = 'ACTIVE' and deleted_at is null
  `, [parsed.data.email.toLowerCase()]);
  const user = result.rows[0];
  if (!user || !(await verifyPassword(parsed.data.password, user.password_hash))) {
    return reply.code(401).send({ error: 'Invalid email or password' });
  }
  await pool.query('update users set last_login_at = now() where id = $1', [user.id]);
  const context = await loadAuthContext(user.id);
  if (!context) return reply.code(403).send({ error: 'User has no active role assignment' });
  return { access_token: await createAccessToken(context.userId, context.email), user: publicUser(context) };
});

app.get('/api/v1/auth/me', { preHandler: authenticateRequest }, async (request) => ({ user: publicUser(request.auth!) }));

app.get('/api/v1/dashboard/summary', { preHandler: requirePermission('dashboard.read') }, async () => {
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

app.get('/api/v1/products', { preHandler: requirePermission('products.read') }, async (request) => {
  const query = request.query as { status?: string };
  const values: string[] = [];
  const statusFilter = query.status ? `and p.status = $1` : '';
  if (query.status) values.push(query.status);
  const result = await pool.query(`
    select p.id, p.master_sku, p.name, p.short_description, p.status,
           p.access_model, p.delivery_method, p.warranty_summary,
           coalesce(json_agg(json_build_object(
             'id', v.id, 'sku', v.sku, 'name', v.name,
             'access_period_months', v.access_period_months,
             'retail_price', v.retail_price, 'reseller_price', v.reseller_price,
             'currency_code', v.currency_code, 'warranty_days', v.warranty_days,
             'status', v.status
           ) order by v.name) filter (where v.id is not null), '[]') as variations
    from products p
    left join product_variations v on v.product_id = p.id and v.deleted_at is null
    where p.deleted_at is null ${statusFilter}
    group by p.id
    order by p.name
  `, values);
  return { data: result.rows };
});

app.get('/api/v1/customers', { preHandler: requirePermission('customers.read') }, async (request) => {
  const query = request.query as { q?: string; limit?: string };
  const limit = Math.min(Math.max(Number(query.limit ?? 50) || 50, 1), 100);
  const values: (string | number)[] = [];
  let where = 'c.deleted_at is null';
  if (query.q?.trim()) {
    values.push(`%${query.q.trim()}%`);
    where += ` and (c.display_name ilike $1 or c.email::text ilike $1 or c.phone ilike $1 or c.public_code ilike $1)`;
  }
  values.push(limit);
  const result = await pool.query(`
    select c.id, c.public_code, c.display_name, c.customer_type, c.country_code,
           c.language_code, c.phone, c.email::text, c.source_code,
           c.last_contact_at, c.last_purchase_at, c.created_at,
           count(o.id)::int as order_count
    from customers c
    left join orders o on o.customer_id = c.id and o.deleted_at is null
    where ${where}
    group by c.id
    order by c.created_at desc
    limit $${values.length}
  `, values);
  return { data: result.rows };
});

app.post('/api/v1/customers', { preHandler: requirePermission('customers.create') }, async (request, reply) => {
  const parsed = customerSchema.safeParse(request.body);
  if (!parsed.success) return sendValidationError(reply, parsed);
  try {
    const result = await pool.query(`
      insert into customers (public_code, display_name, customer_type, country_code, language_code, phone, email, source_code, marketing_consent, assigned_user_id)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      returning id, public_code, display_name, customer_type, country_code, language_code, phone, email::text, source_code, marketing_consent, created_at
    `, [
      makeCode('CUS'), parsed.data.display_name, parsed.data.customer_type, parsed.data.country_code ?? null,
      parsed.data.language_code, parsed.data.phone ?? null, parsed.data.email?.toLowerCase() ?? null,
      parsed.data.source_code ?? null, parsed.data.marketing_consent, request.auth!.userId,
    ]);
    return reply.code(201).send({ data: result.rows[0] });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'A customer with this email or phone already exists' });
    throw error;
  }
});

app.get('/api/v1/customers/:id', { preHandler: requirePermission('customers.read') }, async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid customer id' });
  const result = await pool.query(`
    select id, public_code, display_name, customer_type, country_code, language_code,
           phone, email::text, source_code, marketing_consent, last_contact_at,
           last_purchase_at, created_at, updated_at
    from customers where id = $1 and deleted_at is null
  `, [params.data.id]);
  if (!result.rows[0]) return reply.code(404).send({ error: 'Customer not found' });
  return { data: result.rows[0] };
});

app.get('/api/v1/orders', { preHandler: requirePermission('orders.read') }, async (request) => {
  const query = request.query as { status?: string; limit?: string };
  const limit = Math.min(Math.max(Number(query.limit ?? 50) || 50, 1), 100);
  const values: (string | number)[] = [];
  let where = 'o.deleted_at is null';
  if (query.status) {
    values.push(query.status);
    where += ` and o.status = $1`;
  }
  values.push(limit);
  const result = await pool.query(`
    select o.id, o.public_code, o.status, o.currency_code, o.total_amount,
           o.payment_status, o.delivery_status, o.created_at,
           c.id as customer_id, c.public_code as customer_code, c.display_name as customer_name
    from orders o join customers c on c.id = o.customer_id
    where ${where}
    order by o.created_at desc
    limit $${values.length}
  `, values);
  return { data: result.rows };
});

app.post('/api/v1/orders', { preHandler: requirePermission('orders.create') }, async (request, reply) => {
  const parsed = orderSchema.safeParse(request.body);
  if (!parsed.success) return sendValidationError(reply, parsed);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const customer = await client.query('select id from customers where id = $1 and deleted_at is null', [parsed.data.customer_id]);
    if (!customer.rows[0]) {
      await client.query('rollback');
      return reply.code(404).send({ error: 'Customer not found' });
    }

    let paymentMethodId: string | null = null;
    if (parsed.data.payment_method_code) {
      const method = await client.query(`select id from payment_methods where code = $1 and status = 'ACTIVE'`, [parsed.data.payment_method_code.toUpperCase()]);
      if (!method.rows[0]) {
        await client.query('rollback');
        return reply.code(400).send({ error: 'Payment method is not active or does not exist' });
      }
      paymentMethodId = method.rows[0].id;
    }

    const preparedItems: Array<Record<string, unknown>> = [];
    let subtotal = 0;
    for (const item of parsed.data.items) {
      const variation = await client.query(`
        select v.id, v.product_id, v.sku, v.name as variation_name, v.retail_price,
               v.status as variation_status, p.name as product_name, p.status as product_status
        from product_variations v join products p on p.id = v.product_id
        where v.id = $1 and v.deleted_at is null and p.deleted_at is null
      `, [item.product_variation_id]);
      const row = variation.rows[0];
      if (!row) {
        await client.query('rollback');
        return reply.code(404).send({ error: `Product variation not found: ${item.product_variation_id}` });
      }
      if (['ARCHIVED', 'SOLD_OUT'].includes(row.variation_status) || ['ARCHIVED', 'SOLD_OUT'].includes(row.product_status)) {
        await client.query('rollback');
        return reply.code(409).send({ error: `${row.product_name} is not available for sale` });
      }
      const unitPrice = Number(row.retail_price);
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        await client.query('rollback');
        return reply.code(409).send({ error: `${row.product_name} has no approved retail price yet` });
      }
      const lineTotal = unitPrice * item.quantity;
      subtotal += lineTotal;
      preparedItems.push({ ...item, ...row, unitPrice, lineTotal });
    }

    if (parsed.data.discount_amount > subtotal) {
      await client.query('rollback');
      return reply.code(400).send({ error: 'Discount cannot exceed subtotal' });
    }
    const total = subtotal - parsed.data.discount_amount;
    const order = await client.query(`
      insert into orders (public_code, customer_id, status, currency_code, subtotal_amount, discount_amount, total_amount, payment_method_id, payment_status, delivery_status, assigned_cs_id, created_by)
      values ($1, $2, 'PAYMENT_PENDING', 'MMK', $3, $4, $5, $6, 'PENDING', 'PENDING', $7, $7)
      returning id
    `, [makeCode('ORD'), parsed.data.customer_id, subtotal, parsed.data.discount_amount, total, paymentMethodId, request.auth!.userId]);

    for (const item of preparedItems) {
      await client.query(`
        insert into order_items (order_id, product_id, product_variation_id, product_name_snapshot, variation_name_snapshot, sku_snapshot, quantity, unit_price, line_total)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [order.rows[0].id, item.product_id, item.product_variation_id, item.product_name, item.variation_name, item.sku, item.quantity, item.unitPrice, item.lineTotal]);
    }
    await client.query('commit');
    return reply.code(201).send({ data: await getOrder(order.rows[0].id) });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
});

app.get('/api/v1/orders/:id', { preHandler: requirePermission('orders.read') }, async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid order id' });
  const order = await getOrder(params.data.id);
  if (!order) return reply.code(404).send({ error: 'Order not found' });
  return { data: order };
});

const port = Number(process.env.PORT ?? 10000);
const host = '0.0.0.0';

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
