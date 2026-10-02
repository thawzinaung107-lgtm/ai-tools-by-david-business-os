import 'dotenv/config';
import { Pool, type PoolClient } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const MAX_BATCH = 25;

type OutboxRow = {
  id: string;
  channel: 'EMAIL' | 'TELEGRAM';
  recipient: string;
  subject: string | null;
  body: string;
  attempts: number;
  max_attempts: number;
  payload: Record<string, unknown>;
};

function backoffMinutes(attempts: number) {
  return Math.min(60, Math.max(1, 2 ** Math.min(attempts, 5)));
}

async function sendEmail(row: OutboxRow) {
  const provider = (process.env.EMAIL_PROVIDER ?? 'resend').toLowerCase();
  if (provider === 'console') {
    console.log('[notification:email:console]', { to: row.recipient, subject: row.subject });
    return;
  }
  if (provider !== 'resend') throw new Error(`Unsupported EMAIL_PROVIDER: ${provider}`);
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) throw new Error('Email provider is not configured: RESEND_API_KEY and EMAIL_FROM are required');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [row.recipient], subject: row.subject ?? 'AI Tools By David Digital Store', text: row.body }),
  });
  if (!response.ok) throw new Error(`Resend returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
}

async function sendTelegram(row: OutboxRow) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('Telegram provider is not configured: TELEGRAM_BOT_TOKEN is required');
  const baseUrl = (process.env.TELEGRAM_API_BASE_URL ?? 'https://api.telegram.org').replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: row.recipient, text: row.body, disable_web_page_preview: true }),
  });
  if (!response.ok) throw new Error(`Telegram returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const result = await response.json() as { ok?: boolean; description?: string };
  if (!result.ok) throw new Error(`Telegram rejected message: ${result.description ?? 'unknown error'}`);
}

async function claimBatch(client: PoolClient) {
  const result = await client.query<OutboxRow>(`
    with claimed as (
      select id from notification_outbox
      where status in ('PENDING', 'FAILED')
        and next_attempt_at <= now()
        and attempts < max_attempts
      order by created_at
      for update skip locked
      limit $1
    )
    update notification_outbox n
    set status = 'PROCESSING', attempts = n.attempts + 1, updated_at = now()
    from claimed
    where n.id = claimed.id
    returning n.id, n.channel, n.recipient, n.subject, n.body, n.attempts, n.max_attempts, n.payload
  `, [MAX_BATCH]);
  return result.rows;
}

async function deliverRow(row: OutboxRow) {
  if (row.channel === 'EMAIL') await sendEmail(row);
  else await sendTelegram(row);
}

export async function processNotificationOutbox() {
  const client = await pool.connect();
  try {
    const rows = await claimBatch(client);
    for (const row of rows) {
      try {
        await deliverRow(row);
        await client.query(`update notification_outbox set status = 'SENT', sent_at = now(), last_error = null, updated_at = now() where id = $1`, [row.id]);
        console.log('[notification:sent]', row.channel, row.recipient, row.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown notification error';
        const terminal = row.attempts >= row.max_attempts;
        await client.query(`update notification_outbox set status = $2, last_error = $3, next_attempt_at = case when $2 = 'FAILED' then now() + ($4::int * interval '1 minute') else next_attempt_at end, updated_at = now() where id = $1`, [row.id, terminal ? 'SKIPPED' : 'FAILED', message.slice(0, 1000), backoffMinutes(row.attempts)]);
        console.error('[notification:failed]', row.channel, row.recipient, message);
      }
    }
    return rows.length;
  } finally {
    client.release();
  }
}

export async function closeNotificationPool() {
  await pool.end();
}
