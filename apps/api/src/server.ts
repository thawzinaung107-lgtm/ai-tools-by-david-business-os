import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
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
import { createPaymentProofViewUrl, uploadPaymentProofFile } from './storage.js';
import { queueCustomerNotification } from './notification_outbox.js';

const app = Fastify({ logger: true });

await app.register(helmet);
await app.register(sensible);
await app.register(cors, {
  origin: process.env.CORS_ORIGIN?.split(',').map((value) => value.trim()) ?? false,
  credentials: true,
});
await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 12 } });

const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

const bootstrapSchema = loginSchema.extend({
  display_name: z.string().trim().min(2).max(120),
  bootstrap_secret: z.string().min(1).max(200),
});

const staffSchema = loginSchema.extend({
  display_name: z.string().trim().min(2).max(120),
  role_code: z.enum(['OPERATIONS_MANAGER', 'CS_AGENT', 'FULFILMENT_AGENT']),
});

const customerSchema = z.object({
  display_name: z.string().trim().min(2).max(160),
  customer_type: z.enum(['PERSONAL', 'BUSINESS', 'RESELLER']).default('PERSONAL'),
  country_code: z.string().trim().length(2).toUpperCase().optional(),
  language_code: z.string().trim().min(2).max(10).default('my'),
  phone: z.string().trim().min(5).max(30).optional(),
  email: z.string().email().max(200).optional(),
  telegram_chat_id: z.string().trim().max(100).optional(),
  email_notifications_enabled: z.boolean().default(true),
  telegram_notifications_enabled: z.boolean().default(false),
  source_code: z.string().trim().max(50).optional(),
  marketing_consent: z.boolean().default(false),
});

const notificationPreferenceSchema = z.object({
  email: z.string().email().max(200).optional().nullable(),
  telegram_chat_id: z.string().trim().max(100).optional().nullable(),
  email_notifications_enabled: z.boolean(),
  telegram_notifications_enabled: z.boolean(),
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

const paymentProofSchema = z.object({
  order_id: z.string().uuid(),
  payment_method_code: z.string().trim().min(2).max(50),
  claimed_amount: z.coerce.number().positive(),
  transaction_reference: z.string().trim().min(2).max(160),
  transaction_at: z.string().datetime().optional(),
});

const proofReviewSchema = z.object({
  review_note: z.string().trim().max(500).optional(),
});

const proofRejectSchema = z.object({
  rejection_reason: z.string().trim().min(3).max(255),
  review_note: z.string().trim().max(500).optional(),
});

const deliveryProcessingSchema = z.object({
  delivery_reference: z.string().trim().max(200).optional(),
  message: z.string().trim().max(500).optional(),
});

const deliveryCompleteSchema = z.object({
  delivery_reference: z.string().trim().min(2).max(200),
  access_start_date: z.string().date().optional(),
  expiry_date: z.string().date().optional(),
  message: z.string().trim().max(500).optional(),
});

const deliveryFailSchema = z.object({
  failure_reason: z.string().trim().min(3).max(255),
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

async function getDelivery(deliveryId: string) {
  const result = await pool.query(`
    select d.id, d.public_code, d.status, d.method, d.delivery_reference,
           d.delivered_by, d.delivered_at, d.access_start_date, d.expiry_date,
           d.failure_reason, d.created_at, d.updated_at,
           o.id as order_id, o.public_code as order_code, o.total_amount,
           o.currency_code, o.payment_status, o.delivery_status,
           c.public_code as customer_code, c.display_name as customer_name,
           coalesce(json_agg(json_build_object(
             'id', de.id, 'event_type', de.event_type, 'status', de.status,
             'message', de.message, 'tracking_reference', de.tracking_reference,
             'created_at', de.created_at
           ) order by de.created_at desc) filter (where de.id is not null), '[]') as events
    from deliveries d
    join orders o on o.id = d.order_id
    join customers c on c.id = o.customer_id
    left join delivery_events de on de.delivery_id = d.id
    where d.id = $1
    group by d.id, o.id, c.id
  `, [deliveryId]);
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

app.get('/api/v1/users', { preHandler: requirePermission('users.manage') }, async () => {
  const result = await pool.query(`
    select u.id, u.email::text, u.display_name, u.status, u.last_login_at, u.created_at,
           coalesce(array_agg(distinct r.code) filter (where r.code is not null), '{}') as roles
    from users u
    left join user_roles ur on ur.user_id = u.id
    left join roles r on r.id = ur.role_id
    where u.deleted_at is null
    group by u.id
    order by u.created_at desc
  `);
  return { data: result.rows };
});

app.post('/api/v1/users', { preHandler: requirePermission('users.manage') }, async (request, reply) => {
  const parsed = staffSchema.safeParse(request.body);
  if (!parsed.success) return sendValidationError(reply, parsed);
  const passwordHash = await hashPassword(parsed.data.password);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const user = await client.query(`
      insert into users (email, display_name, password_hash, status)
      values ($1, $2, $3, 'ACTIVE')
      returning id, email::text, display_name, status, created_at
    `, [parsed.data.email.toLowerCase(), parsed.data.display_name, passwordHash]);
    const role = await client.query('select id, code from roles where code = $1', [parsed.data.role_code]);
    if (!role.rows[0]) {
      await client.query('rollback');
      return reply.code(400).send({ error: 'Requested role does not exist' });
    }
    await client.query('insert into user_roles (user_id, role_id, assigned_by) values ($1, $2, $3)', [user.rows[0].id, role.rows[0].id, request.auth!.userId]);
    await client.query('insert into audit_logs (actor_user_id, action, entity_type, entity_id, after_json) values ($1, $2, $3, $4, $5)', [request.auth!.userId, 'CREATE_STAFF_USER', 'USER', user.rows[0].id, JSON.stringify({ email: user.rows[0].email, role: role.rows[0].code })]);
    await client.query('commit');
    return reply.code(201).send({ data: { ...user.rows[0], role: role.rows[0].code } });
  } catch (error) {
    await client.query('rollback');
    if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'Email is already registered' });
    throw error;
  } finally {
    client.release();
  }
});

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

app.get('/api/v1/dashboard/analytics', { preHandler: requirePermission('reports.read') }, async (request, reply) => {
  const query = request.query as { range_days?: string };
  const rangeDays = Math.min(Math.max(Number(query.range_days ?? 30) || 30, 7), 90);
  const [kpis, daily, products, paymentBreakdown] = await Promise.all([
    pool.query(`
      select
        count(*)::int as order_count,
        count(*) filter (where payment_status = 'VERIFIED')::int as verified_order_count,
        count(*) filter (where payment_status = 'REJECTED')::int as rejected_payment_count,
        coalesce(sum(total_amount) filter (where payment_status = 'VERIFIED'), 0)::numeric as verified_revenue,
        coalesce(avg(total_amount) filter (where payment_status = 'VERIFIED'), 0)::numeric as average_verified_order_value,
        (select count(*)::int from customers where created_at >= current_date - ($1::int - 1) and deleted_at is null) as new_customer_count
      from orders
      where created_at >= current_date - ($1::int - 1) and deleted_at is null
    `, [rangeDays]),
    pool.query(`
      select to_char(day::date, 'YYYY-MM-DD') as date,
             coalesce(count(o.id), 0)::int as order_count,
             coalesce(sum(o.total_amount) filter (where o.payment_status = 'VERIFIED'), 0)::numeric as verified_revenue
      from generate_series(current_date - ($1::int - 1), current_date, interval '1 day') as day
      left join orders o on o.created_at::date = day::date and o.deleted_at is null
      group by day::date
      order by day::date
    `, [rangeDays]),
    pool.query(`
      select oi.product_name_snapshot as product_name,
             coalesce(sum(oi.quantity), 0)::int as units_sold,
             coalesce(sum(oi.line_total), 0)::numeric as verified_revenue
      from order_items oi join orders o on o.id = oi.order_id
      where o.created_at >= current_date - ($1::int - 1)
        and o.deleted_at is null and o.payment_status = 'VERIFIED'
      group by oi.product_name_snapshot
      order by verified_revenue desc
      limit 8
    `, [rangeDays]),
    pool.query(`
      select payment_status as status, count(*)::int as count
      from orders
      where created_at >= current_date - ($1::int - 1) and deleted_at is null
      group by payment_status
      order by count desc
    `, [rangeDays]),
  ]);
  if (!kpis.rows[0]) return reply.code(500).send({ error: 'Analytics could not be calculated' });
  return { data: { range_days: rangeDays, kpis: kpis.rows[0], daily: daily.rows, top_products: products.rows, payment_breakdown: paymentBreakdown.rows } };
});

app.get('/api/v1/notifications/outbox', { preHandler: requirePermission('notifications.read') }, async (request) => {
  const query = request.query as { status?: string; limit?: string };
  const limit = Math.min(Math.max(Number(query.limit ?? 50) || 50, 1), 100);
  const values: (string | number)[] = [];
  let where = '1 = 1';
  if (query.status) {
    values.push(query.status);
    where += ` and n.status = $1`;
  }
  values.push(limit);
  const result = await pool.query(`
    select n.id, n.channel, n.event_type, n.recipient, n.subject, n.status,
           n.attempts, n.max_attempts, n.last_error, n.sent_at, n.created_at,
           c.public_code as customer_code, c.display_name as customer_name,
           o.public_code as order_code
    from notification_outbox n
    join customers c on c.id = n.customer_id
    left join orders o on o.id = n.order_id
    where ${where}
    order by n.created_at desc
    limit $${values.length}
  `, values);
  return { data: result.rows };
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
           c.language_code, c.phone, c.email::text, c.telegram_chat_id,
           c.email_notifications_enabled, c.telegram_notifications_enabled, c.source_code,
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
      insert into customers (public_code, display_name, customer_type, country_code, language_code, phone, email, telegram_chat_id, email_notifications_enabled, telegram_notifications_enabled, source_code, marketing_consent, assigned_user_id)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      returning id, public_code, display_name, customer_type, country_code, language_code, phone, email::text, telegram_chat_id, email_notifications_enabled, telegram_notifications_enabled, source_code, marketing_consent, created_at
    `, [
      makeCode('CUS'), parsed.data.display_name, parsed.data.customer_type, parsed.data.country_code ?? null,
      parsed.data.language_code, parsed.data.phone ?? null, parsed.data.email?.toLowerCase() ?? null,
      parsed.data.telegram_chat_id ?? null, parsed.data.email_notifications_enabled,
      parsed.data.telegram_notifications_enabled, parsed.data.source_code ?? null,
      parsed.data.marketing_consent, request.auth!.userId,
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
           phone, email::text, telegram_chat_id, email_notifications_enabled,
           telegram_notifications_enabled, source_code, marketing_consent, last_contact_at,
           last_purchase_at, created_at, updated_at
    from customers where id = $1 and deleted_at is null
  `, [params.data.id]);
  if (!result.rows[0]) return reply.code(404).send({ error: 'Customer not found' });
  return { data: result.rows[0] };
});

app.patch('/api/v1/customers/:id/notification-preferences', { preHandler: requirePermission('customers.update') }, async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
  const parsed = notificationPreferenceSchema.safeParse(request.body);
  if (!params.success) return reply.code(400).send({ error: 'Invalid customer id' });
  if (!parsed.success) return sendValidationError(reply, parsed);
  const result = await pool.query(`
    update customers
    set email = $2, telegram_chat_id = $3,
        email_notifications_enabled = $4, telegram_notifications_enabled = $5,
        updated_at = now()
    where id = $1 and deleted_at is null
    returning id, public_code, display_name, email::text, telegram_chat_id,
              email_notifications_enabled, telegram_notifications_enabled, updated_at
  `, [
    params.data.id,
    parsed.data.email?.toLowerCase() ?? null,
    parsed.data.telegram_chat_id ?? null,
    parsed.data.email_notifications_enabled,
    parsed.data.telegram_notifications_enabled,
  ]);
  if (!result.rows[0]) return reply.code(404).send({ error: 'Customer not found' });
  return { data: result.rows[0] };
});

app.get('/api/v1/orders', { preHandler: requirePermission('orders.read') }, async (request, reply) => {
  const query = request.query as { status?: string; customer_id?: string; limit?: string };
  if (query.customer_id && !z.string().uuid().safeParse(query.customer_id).success) return reply.code(400).send({ error: 'Invalid customer_id' });
  const limit = Math.min(Math.max(Number(query.limit ?? 50) || 50, 1), 100);
  const values: (string | number)[] = [];
  let where = 'o.deleted_at is null';
  if (query.status) {
    values.push(query.status);
    where += ` and o.status = $1`;
  }
  if (query.customer_id) {
    values.push(query.customer_id);
    where += ` and o.customer_id = $${values.length}`;
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

app.get('/api/v1/payment-proofs', { preHandler: requirePermission('payments.read') }, async (request) => {
  const query = request.query as { status?: string; limit?: string };
  const limit = Math.min(Math.max(Number(query.limit ?? 50) || 50, 1), 100);
  const values: (string | number)[] = [];
  let where = 'pp.status is not null';
  if (query.status) {
    values.push(query.status);
    where += ' and pp.status = $1';
  }
  values.push(limit);
  const result = await pool.query(`
    select pp.id, pp.public_code, pp.order_id, o.public_code as order_code,
           o.total_amount as order_total, pp.claimed_amount, pp.transaction_reference,
           pp.transaction_at, pp.status, pp.review_note, pp.rejection_reason,
           pp.created_at, c.public_code as customer_code, c.display_name as customer_name,
           pm.code as payment_method_code, pm.display_name as payment_method_name,
           ppf.original_filename, ppf.mime_type, ppf.byte_size
    from payment_proofs pp
    join orders o on o.id = pp.order_id
    join customers c on c.id = o.customer_id
    join payment_methods pm on pm.id = pp.payment_method_id
    left join payment_proof_files ppf on ppf.payment_proof_id = pp.id
    where ${where}
    order by pp.created_at desc
    limit $${values.length}
  `, values);
  return { data: result.rows };
});

app.get('/api/v1/payment-proofs/:id/view-url', { preHandler: requirePermission('payments.read') }, async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid payment proof id' });
  const result = await pool.query(`
    select ppf.storage_key, ppf.original_filename, ppf.mime_type, ppf.byte_size,
           pp.id as payment_proof_id, pp.public_code, pp.status
    from payment_proof_files ppf join payment_proofs pp on pp.id = ppf.payment_proof_id
    where ppf.payment_proof_id = $1
  `, [params.data.id]);
  if (!result.rows[0]) return reply.code(404).send({ error: 'Payment proof file not found' });
  try {
    return { data: { payment_proof_id: result.rows[0].payment_proof_id, public_code: result.rows[0].public_code, status: result.rows[0].status, filename: result.rows[0].original_filename, mime_type: result.rows[0].mime_type, byte_size: result.rows[0].byte_size, url: await createPaymentProofViewUrl(result.rows[0].storage_key), expires_in_seconds: 300 } };
  } catch (error) {
    if ((error as Error).message === 'Private object storage is not configured') return reply.code(503).send({ error: 'Private object storage is not configured yet' });
    throw error;
  }
});

app.post('/api/v1/payment-proofs', { preHandler: requirePermission('payments.read') }, async (request, reply) => {
  const fields: Record<string, string> = {};
  let uploadedFile: { filename: string; mimeType: string; bytes: Buffer } | null = null;
  try {
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (uploadedFile) return reply.code(400).send({ error: 'Only one payment-proof file is allowed' });
        uploadedFile = { filename: part.filename, mimeType: part.mimetype, bytes: await part.toBuffer() };
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }
  } catch (error) {
    if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: 'Payment proof must not exceed 10 MB' });
    throw error;
  }
  if (!uploadedFile) return reply.code(400).send({ error: 'A payment-proof file is required' });
  const parsed = paymentProofSchema.safeParse(fields);
  if (!parsed.success) return sendValidationError(reply, parsed);

  const client = await pool.connect();
  try {
    await client.query('begin');
    const order = await client.query(`
      select o.id, o.public_code, o.customer_id, o.total_amount, o.payment_status,
             pm.id as payment_method_id
      from orders o
      left join payment_methods pm on pm.code = $2 and pm.status = 'ACTIVE'
      where o.id = $1 and o.deleted_at is null
      for update of o
    `, [parsed.data.order_id, parsed.data.payment_method_code.toUpperCase()]);
    const orderRow = order.rows[0];
    if (!orderRow) {
      await client.query('rollback');
      return reply.code(404).send({ error: 'Order not found' });
    }
    if (!orderRow.payment_method_id) {
      await client.query('rollback');
      return reply.code(400).send({ error: 'Payment method is not active or does not exist' });
    }
    if (['VERIFIED', 'REFUNDED'].includes(orderRow.payment_status)) {
      await client.query('rollback');
      return reply.code(409).send({ error: 'This order is already paid and cannot accept another proof' });
    }
    if (Number(parsed.data.claimed_amount) !== Number(orderRow.total_amount)) {
      await client.query('rollback');
      return reply.code(400).send({ error: 'Claimed amount must match the order total for this MVP flow' });
    }

    const proof = await client.query(`
      insert into payment_proofs (public_code, order_id, payment_method_id, claimed_amount, transaction_reference, transaction_at, status, submitted_by)
      values ($1, $2, $3, $4, $5, $6, 'PROOF_RECEIVED', $7)
      returning id, public_code, status, created_at
    `, [makeCode('PAY'), orderRow.id, orderRow.payment_method_id, parsed.data.claimed_amount, parsed.data.transaction_reference, parsed.data.transaction_at ?? null, request.auth!.userId]);

    const file = await uploadPaymentProofFile({ paymentProofId: proof.rows[0].id, ...uploadedFile });
    await client.query(`
      insert into payment_proof_files (payment_proof_id, storage_key, original_filename, mime_type, byte_size, checksum_sha256, uploaded_by)
      values ($1, $2, $3, $4, $5, $6, $7)
    `, [proof.rows[0].id, file.storageKey, file.originalFilename, file.mimeType, file.byteSize, file.checksumSha256, request.auth!.userId]);
    await client.query(`update orders set status = 'PAYMENT_PROOF_RECEIVED', payment_status = 'PROOF_RECEIVED', updated_at = now() where id = $1`, [orderRow.id]);
    await client.query(`
      insert into audit_logs (actor_user_id, action, entity_type, entity_id, after_json)
      values ($1, 'SUBMIT_PAYMENT_PROOF', 'PAYMENT_PROOF', $2, $3)
    `, [request.auth!.userId, proof.rows[0].id, JSON.stringify({ order_id: orderRow.id, filename: file.originalFilename, byte_size: file.byteSize })]);
    await queueCustomerNotification(client, {
      customerId: orderRow.customer_id,
      orderId: orderRow.id,
      orderCode: orderRow.public_code,
      sourceKey: proof.rows[0].id,
      eventType: 'PAYMENT_PROOF_RECEIVED',
      amount: parsed.data.claimed_amount,
      currencyCode: 'MMK',
    });
    await client.query('commit');
    return reply.code(201).send({ data: { ...proof.rows[0], order_id: orderRow.id, order_code: orderRow.public_code, filename: file.originalFilename, mime_type: file.mimeType, byte_size: file.byteSize } });
  } catch (error) {
    await client.query('rollback');
    if ((error as Error).message === 'Private object storage is not configured') return reply.code(503).send({ error: 'Private object storage is not configured yet' });
    if ((error as { code?: string }).code === '23505') return reply.code(409).send({ error: 'This transaction reference has already been submitted' });
    throw error;
  } finally {
    client.release();
  }
});

app.post('/api/v1/payment-proofs/:id/verify', { preHandler: requirePermission('payments.verify') }, async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
  const parsed = proofReviewSchema.safeParse(request.body ?? {});
  if (!params.success) return reply.code(400).send({ error: 'Invalid payment proof id' });
  if (!parsed.success) return sendValidationError(reply, parsed);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const proof = await client.query(`select pp.id, pp.order_id, pp.status, o.public_code as order_code, o.customer_id, o.total_amount from payment_proofs pp join orders o on o.id = pp.order_id where pp.id = $1 for update`, [params.data.id]);
    const row = proof.rows[0];
    if (!row) { await client.query('rollback'); return reply.code(404).send({ error: 'Payment proof not found' }); }
    if (row.status !== 'PROOF_RECEIVED' && row.status !== 'NEED_MORE_INFORMATION') { await client.query('rollback'); return reply.code(409).send({ error: `Payment proof is already ${row.status}` }); }
    await client.query(`update payment_proofs set status = 'VERIFIED', verified_by = $2, verified_at = now(), review_note = $3, updated_at = now() where id = $1`, [row.id, request.auth!.userId, parsed.data.review_note ?? null]);
    await client.query(`
      insert into payments (order_id, payment_proof_id, status, amount_received, currency_code, verified_by, verified_at)
      select order_id, id, 'VERIFIED', claimed_amount, 'MMK', $2, now() from payment_proofs where id = $1
      on conflict (order_id) do update set payment_proof_id = excluded.payment_proof_id, status = 'VERIFIED', amount_received = excluded.amount_received, verified_by = excluded.verified_by, verified_at = excluded.verified_at, updated_at = now()
    `, [row.id, request.auth!.userId]);
    await client.query(`update orders set status = 'DELIVERY_PENDING', payment_status = 'VERIFIED', delivery_status = 'PENDING', updated_at = now() where id = $1`, [row.order_id]);
    const delivery = await client.query(`insert into deliveries (public_code, order_id, status, method) values ($1, $2, 'PENDING', 'MANUAL_DIGITAL') returning id, public_code`, [makeCode('DEL'), row.order_id]);
    await client.query(`insert into delivery_events (delivery_id, event_type, status, message, created_by) values ($1, 'QUEUED', 'PENDING', 'Payment verified; delivery queued', $2)`, [delivery.rows[0].id, request.auth!.userId]);
    await client.query(`insert into audit_logs (actor_user_id, action, entity_type, entity_id, after_json) values ($1, 'VERIFY_PAYMENT_PROOF', 'PAYMENT_PROOF', $2, $3)`, [request.auth!.userId, row.id, JSON.stringify({ order_id: row.order_id, order_code: row.order_code, review_note: parsed.data.review_note ?? null })]);
    await queueCustomerNotification(client, {
      customerId: row.customer_id,
      orderId: row.order_id,
      orderCode: row.order_code,
      sourceKey: row.id,
      eventType: 'PAYMENT_VERIFIED',
      amount: row.total_amount,
      currencyCode: 'MMK',
      deliveryCode: delivery.rows[0].public_code,
    });
    await client.query('commit');
    return { data: { payment_proof_id: row.id, order_id: row.order_id, order_code: row.order_code, payment_status: 'VERIFIED', delivery_status: 'PENDING' } };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
});

app.post('/api/v1/payment-proofs/:id/reject', { preHandler: requirePermission('payments.verify') }, async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
  const parsed = proofRejectSchema.safeParse(request.body);
  if (!params.success) return reply.code(400).send({ error: 'Invalid payment proof id' });
  if (!parsed.success) return sendValidationError(reply, parsed);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const proof = await client.query(`select pp.id, pp.order_id, pp.status, pp.claimed_amount, pp.payment_method_id, o.public_code as order_code, o.customer_id from payment_proofs pp join orders o on o.id = pp.order_id where pp.id = $1 for update`, [params.data.id]);
    const row = proof.rows[0];
    if (!row) { await client.query('rollback'); return reply.code(404).send({ error: 'Payment proof not found' }); }
    if (row.status !== 'PROOF_RECEIVED' && row.status !== 'NEED_MORE_INFORMATION') { await client.query('rollback'); return reply.code(409).send({ error: `Payment proof is already ${row.status}` }); }
    await client.query(`update payment_proofs set status = 'REJECTED', verified_by = $2, verified_at = now(), rejection_reason = $3, review_note = $4, updated_at = now() where id = $1`, [row.id, request.auth!.userId, parsed.data.rejection_reason, parsed.data.review_note ?? null]);
    await client.query(`insert into payments (order_id, payment_proof_id, status, amount_received, currency_code, verified_by, verified_at, rejection_reason) values ($1, $2, 'REJECTED', $3, 'MMK', $4, now(), $5) on conflict (order_id) do update set payment_proof_id = excluded.payment_proof_id, status = 'REJECTED', amount_received = excluded.amount_received, verified_by = excluded.verified_by, verified_at = excluded.verified_at, rejection_reason = excluded.rejection_reason, updated_at = now()`, [row.order_id, row.id, row.claimed_amount, request.auth!.userId, parsed.data.rejection_reason]);
    await client.query(`update orders set status = 'PAYMENT_PENDING', payment_status = 'REJECTED', updated_at = now() where id = $1`, [row.order_id]);
    await client.query(`insert into audit_logs (actor_user_id, action, entity_type, entity_id, after_json) values ($1, 'REJECT_PAYMENT_PROOF', 'PAYMENT_PROOF', $2, $3)`, [request.auth!.userId, row.id, JSON.stringify({ order_id: row.order_id, order_code: row.order_code, rejection_reason: parsed.data.rejection_reason })]);
    await queueCustomerNotification(client, {
      customerId: row.customer_id,
      orderId: row.order_id,
      orderCode: row.order_code,
      sourceKey: row.id,
      eventType: 'PAYMENT_REJECTED',
      amount: row.claimed_amount,
      currencyCode: 'MMK',
      rejectionReason: parsed.data.rejection_reason,
    });
    await client.query('commit');
    return { data: { payment_proof_id: row.id, order_id: row.order_id, order_code: row.order_code, payment_status: 'REJECTED', rejection_reason: parsed.data.rejection_reason } };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
});

app.get('/api/v1/deliveries', { preHandler: requirePermission('delivery.read') }, async (request) => {
  const query = request.query as { status?: string; limit?: string };
  const limit = Math.min(Math.max(Number(query.limit ?? 50) || 50, 1), 100);
  const values: (string | number)[] = [];
  let where = '1 = 1';
  if (query.status) {
    values.push(query.status);
    where += ` and d.status = $1`;
  }
  values.push(limit);
  const result = await pool.query(`
    select d.id, d.public_code, d.status, d.method, d.delivery_reference,
           d.delivered_at, d.access_start_date, d.expiry_date, d.failure_reason,
           d.created_at, o.id as order_id, o.public_code as order_code,
           o.total_amount, o.currency_code, o.payment_status,
           c.public_code as customer_code, c.display_name as customer_name
    from deliveries d join orders o on o.id = d.order_id join customers c on c.id = o.customer_id
    where ${where}
    order by case d.status when 'PROCESSING' then 1 when 'PENDING' then 2 when 'FAILED' then 3 else 4 end, d.created_at desc
    limit $${values.length}
  `, values);
  return { data: result.rows };
});

app.get('/api/v1/deliveries/:id', { preHandler: requirePermission('delivery.read') }, async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid delivery id' });
  const delivery = await getDelivery(params.data.id);
  if (!delivery) return reply.code(404).send({ error: 'Delivery not found' });
  return { data: delivery };
});

app.post('/api/v1/deliveries/:id/start', { preHandler: requirePermission('delivery.update') }, async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
  const parsed = deliveryProcessingSchema.safeParse(request.body ?? {});
  if (!params.success) return reply.code(400).send({ error: 'Invalid delivery id' });
  if (!parsed.success) return sendValidationError(reply, parsed);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select d.id, d.public_code, d.status, d.order_id, o.public_code as order_code, o.customer_id, o.payment_status from deliveries d join orders o on o.id = d.order_id where d.id = $1 for update`, [params.data.id]);
    const row = result.rows[0];
    if (!row) { await client.query('rollback'); return reply.code(404).send({ error: 'Delivery not found' }); }
    if (row.payment_status !== 'VERIFIED') { await client.query('rollback'); return reply.code(409).send({ error: 'Delivery is blocked until payment is verified' }); }
    if (row.status !== 'PENDING') { await client.query('rollback'); return reply.code(409).send({ error: `Delivery is already ${row.status}` }); }
    await client.query(`update deliveries set status = 'PROCESSING', delivery_reference = coalesce($2, delivery_reference), updated_at = now() where id = $1`, [row.id, parsed.data.delivery_reference ?? null]);
    await client.query(`insert into delivery_events (delivery_id, event_type, status, message, tracking_reference, created_by) values ($1, 'PROCESSING_STARTED', 'PROCESSING', $2, $3, $4)`, [row.id, parsed.data.message ?? 'Fulfilment started', parsed.data.delivery_reference ?? null, request.auth!.userId]);
    await client.query(`insert into audit_logs (actor_user_id, action, entity_type, entity_id, after_json) values ($1, 'START_DELIVERY', 'DELIVERY', $2, $3)`, [request.auth!.userId, row.id, JSON.stringify({ order_id: row.order_id, order_code: row.order_code, delivery_reference: parsed.data.delivery_reference ?? null })]);
    await queueCustomerNotification(client, {
      customerId: row.customer_id,
      orderId: row.order_id,
      orderCode: row.order_code,
      sourceKey: row.id,
      eventType: 'DELIVERY_PROCESSING',
      deliveryCode: row.public_code,
      deliveryReference: parsed.data.delivery_reference ?? null,
    });
    await client.query('commit');
    return { data: await getDelivery(row.id) };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { client.release(); }
});

app.post('/api/v1/deliveries/:id/complete', { preHandler: requirePermission('delivery.update') }, async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
  const parsed = deliveryCompleteSchema.safeParse(request.body);
  if (!params.success) return reply.code(400).send({ error: 'Invalid delivery id' });
  if (!parsed.success) return sendValidationError(reply, parsed);
  if (parsed.data.access_start_date && parsed.data.expiry_date && parsed.data.expiry_date < parsed.data.access_start_date) return reply.code(400).send({ error: 'Expiry date cannot be before access start date' });
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select d.id, d.public_code, d.status, d.order_id, o.public_code as order_code, o.customer_id, o.payment_status from deliveries d join orders o on o.id = d.order_id where d.id = $1 for update`, [params.data.id]);
    const row = result.rows[0];
    if (!row) { await client.query('rollback'); return reply.code(404).send({ error: 'Delivery not found' }); }
    if (row.payment_status !== 'VERIFIED') { await client.query('rollback'); return reply.code(409).send({ error: 'Delivery is blocked until payment is verified' }); }
    if (!['PENDING', 'PROCESSING'].includes(row.status)) { await client.query('rollback'); return reply.code(409).send({ error: `Delivery is already ${row.status}` }); }
    await client.query(`update deliveries set status = 'DELIVERED', delivery_reference = $2, delivered_by = $3, delivered_at = now(), access_start_date = $4, expiry_date = $5, updated_at = now() where id = $1`, [row.id, parsed.data.delivery_reference, request.auth!.userId, parsed.data.access_start_date ?? null, parsed.data.expiry_date ?? null]);
    await client.query(`update orders set status = 'DELIVERED', delivery_status = 'DELIVERED', access_start_date = $2, expiry_date = $3, updated_at = now() where id = $1`, [row.order_id, parsed.data.access_start_date ?? null, parsed.data.expiry_date ?? null]);
    await client.query(`insert into delivery_events (delivery_id, event_type, status, message, tracking_reference, created_by) values ($1, 'DELIVERED', 'DELIVERED', $2, $3, $4)`, [row.id, parsed.data.message ?? 'Digital product delivered', parsed.data.delivery_reference, request.auth!.userId]);
    await client.query(`insert into audit_logs (actor_user_id, action, entity_type, entity_id, after_json) values ($1, 'COMPLETE_DELIVERY', 'DELIVERY', $2, $3)`, [request.auth!.userId, row.id, JSON.stringify({ order_id: row.order_id, order_code: row.order_code, delivery_reference: parsed.data.delivery_reference, access_start_date: parsed.data.access_start_date ?? null, expiry_date: parsed.data.expiry_date ?? null })]);
    await queueCustomerNotification(client, {
      customerId: row.customer_id,
      orderId: row.order_id,
      orderCode: row.order_code,
      sourceKey: row.id,
      eventType: 'DELIVERY_COMPLETED',
      deliveryCode: row.public_code,
      deliveryReference: parsed.data.delivery_reference,
      expiryDate: parsed.data.expiry_date ?? null,
    });
    await client.query('commit');
    return { data: await getDelivery(row.id) };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { client.release(); }
});

app.post('/api/v1/deliveries/:id/fail', { preHandler: requirePermission('delivery.update') }, async (request, reply) => {
  const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
  const parsed = deliveryFailSchema.safeParse(request.body);
  if (!params.success) return reply.code(400).send({ error: 'Invalid delivery id' });
  if (!parsed.success) return sendValidationError(reply, parsed);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select d.id, d.public_code, d.status, d.order_id, o.public_code as order_code, o.customer_id from deliveries d join orders o on o.id = d.order_id where d.id = $1 for update`, [params.data.id]);
    const row = result.rows[0];
    if (!row) { await client.query('rollback'); return reply.code(404).send({ error: 'Delivery not found' }); }
    if (!['PENDING', 'PROCESSING'].includes(row.status)) { await client.query('rollback'); return reply.code(409).send({ error: `Delivery is already ${row.status}` }); }
    await client.query(`update deliveries set status = 'FAILED', failure_reason = $2, updated_at = now() where id = $1`, [row.id, parsed.data.failure_reason]);
    await client.query(`update orders set delivery_status = 'FAILED', updated_at = now() where id = $1`, [row.order_id]);
    await client.query(`insert into delivery_events (delivery_id, event_type, status, message, created_by) values ($1, 'DELIVERY_FAILED', 'FAILED', $2, $3)`, [row.id, parsed.data.failure_reason, request.auth!.userId]);
    await client.query(`insert into audit_logs (actor_user_id, action, entity_type, entity_id, after_json) values ($1, 'FAIL_DELIVERY', 'DELIVERY', $2, $3)`, [request.auth!.userId, row.id, JSON.stringify({ order_id: row.order_id, order_code: row.order_code, failure_reason: parsed.data.failure_reason })]);
    await queueCustomerNotification(client, {
      customerId: row.customer_id,
      orderId: row.order_id,
      orderCode: row.order_code,
      sourceKey: row.id,
      eventType: 'DELIVERY_FAILED',
      deliveryCode: row.public_code,
      failureReason: parsed.data.failure_reason,
    });
    await client.query('commit');
    return { data: await getDelivery(row.id) };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { client.release(); }
});

app.get('/api/v1/tracking/:publicCode', async (request, reply) => {
  const params = z.object({ publicCode: z.string().regex(/^DEL-[A-Z0-9]+$/) }).safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: 'Invalid tracking code' });
  const result = await pool.query(`
    select d.public_code as tracking_code, o.public_code as order_code,
           d.status, d.method, d.delivery_reference, d.access_start_date,
           d.expiry_date, d.delivered_at,
           coalesce(json_agg(json_build_object(
             'event_type', de.event_type, 'status', de.status,
             'message', de.message, 'tracking_reference', de.tracking_reference,
             'created_at', de.created_at
           ) order by de.created_at desc) filter (where de.id is not null), '[]') as events
    from deliveries d join orders o on o.id = d.order_id
    left join delivery_events de on de.delivery_id = d.id
    where d.public_code = $1
    group by d.id, o.id
  `, [params.data.publicCode]);
  if (!result.rows[0]) return reply.code(404).send({ error: 'Tracking code not found' });
  return { data: result.rows[0] };
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
