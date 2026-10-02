import type { PoolClient } from 'pg';
import { renderCustomerNotification, type CustomerNotificationEvent } from './notification_templates.js';

type QueueNotificationInput = {
  customerId: string;
  orderId: string;
  orderCode: string;
  sourceKey: string;
  eventType: CustomerNotificationEvent;
  amount?: string | number;
  currencyCode?: string;
  deliveryCode?: string | null;
  deliveryReference?: string | null;
  expiryDate?: string | null;
  rejectionReason?: string | null;
  failureReason?: string | null;
};

export async function queueCustomerNotification(client: PoolClient, input: QueueNotificationInput) {
  const result = await client.query(`
    select display_name, language_code, email::text, telegram_chat_id,
           email_notifications_enabled, telegram_notifications_enabled
    from customers where id = $1 and deleted_at is null
  `, [input.customerId]);
  const customer = result.rows[0];
  if (!customer) return 0;

  const rendered = renderCustomerNotification({
    eventType: input.eventType,
    customerName: customer.display_name,
    languageCode: customer.language_code,
    orderCode: input.orderCode,
    amount: input.amount,
    currencyCode: input.currencyCode,
    deliveryCode: input.deliveryCode,
    deliveryReference: input.deliveryReference,
    expiryDate: input.expiryDate,
    rejectionReason: input.rejectionReason,
    failureReason: input.failureReason,
    trackingUrl: input.deliveryCode && process.env.PUBLIC_TRACKING_BASE_URL ? `${process.env.PUBLIC_TRACKING_BASE_URL.replace(/\/$/, '')}/${input.deliveryCode}` : null,
  });

  const targets: Array<{ channel: 'EMAIL' | 'TELEGRAM'; recipient: string }> = [];
  if (customer.email_notifications_enabled && customer.email) targets.push({ channel: 'EMAIL', recipient: customer.email });
  if (customer.telegram_notifications_enabled && customer.telegram_chat_id) targets.push({ channel: 'TELEGRAM', recipient: customer.telegram_chat_id });

  for (const target of targets) {
    const idempotencyKey = `${input.sourceKey}:${input.eventType}:${target.channel}:${target.recipient}`;
    await client.query(`
      insert into notification_outbox
        (idempotency_key, channel, event_type, customer_id, order_id, recipient, subject, body, payload)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      on conflict (idempotency_key) do nothing
    `, [
      idempotencyKey,
      target.channel,
      input.eventType,
      input.customerId,
      input.orderId,
      target.recipient,
      target.channel === 'EMAIL' ? rendered.subject : null,
      rendered.body,
      JSON.stringify(rendered.payload),
    ]);
  }
  return targets.length;
}
