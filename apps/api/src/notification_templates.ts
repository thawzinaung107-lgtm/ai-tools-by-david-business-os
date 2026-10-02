export type CustomerNotificationEvent =
  | 'PAYMENT_PROOF_RECEIVED'
  | 'PAYMENT_VERIFIED'
  | 'PAYMENT_REJECTED'
  | 'DELIVERY_PROCESSING'
  | 'DELIVERY_COMPLETED'
  | 'DELIVERY_FAILED';

export type CustomerNotificationInput = {
  eventType: CustomerNotificationEvent;
  customerName: string;
  languageCode?: string;
  orderCode: string;
  amount?: string | number;
  currencyCode?: string;
  deliveryCode?: string | null;
  deliveryReference?: string | null;
  expiryDate?: string | null;
  rejectionReason?: string | null;
  failureReason?: string | null;
  trackingUrl?: string | null;
};

export type RenderedCustomerNotification = {
  subject: string;
  body: string;
  payload: Record<string, unknown>;
};

function money(value: string | number | undefined, currencyCode: string) {
  if (value === undefined || value === null || value === '') return '';
  return `${new Intl.NumberFormat('en-US').format(Number(value))} ${currencyCode}`;
}

export function renderCustomerNotification(input: CustomerNotificationInput): RenderedCustomerNotification {
  const isMyanmar = (input.languageCode ?? 'my').toLowerCase().startsWith('my');
  const order = input.orderCode;
  const amount = money(input.amount, input.currencyCode ?? 'MMK');
  const tracking = input.trackingUrl ? `\nTracking: ${input.trackingUrl}` : '';
  const payload = { event_type: input.eventType, order_code: order, delivery_code: input.deliveryCode ?? null };

  if (isMyanmar) {
    const subjects: Record<CustomerNotificationEvent, string> = {
      PAYMENT_PROOF_RECEIVED: `ငွေပေးချေမှု အထောက်အထား လက်ခံရရှိပါပြီ — ${order}`,
      PAYMENT_VERIFIED: `ငွေပေးချေမှု အတည်ပြုပြီးပါပြီ — ${order}`,
      PAYMENT_REJECTED: `ငွေပေးချေမှု အထောက်အထား ပြန်လည်တင်ရန်လိုပါသည် — ${order}`,
      DELIVERY_PROCESSING: `သင့် Digital Product ကို ပြင်ဆင်ပေးနေပါပြီ — ${order}`,
      DELIVERY_COMPLETED: `Digital Product Delivery ပြီးမြောက်ပါပြီ — ${order}`,
      DELIVERY_FAILED: `Delivery အတွက် အကူအညီလိုအပ်နေပါသည် — ${order}`,
    };
    const bodies: Record<CustomerNotificationEvent, string> = {
      PAYMENT_PROOF_RECEIVED: `မင်္ဂလာပါ ${input.customerName}၊\n${order} အတွက် ${amount} ငွေပေးချေမှု အထောက်အထားကို လက်ခံရရှိပါပြီ။ Owner မှ စစ်ဆေးပြီးနောက် ထပ်မံအကြောင်းကြားပေးပါမယ်။`,
      PAYMENT_VERIFIED: `မင်္ဂလာပါ ${input.customerName}၊\n${order} အတွက် ${amount} ငွေပေးချေမှုကို အတည်ပြုပြီးပါပြီ။ Delivery team က Digital Product ကို ပြင်ဆင်ပေးပါမယ်။`,
      PAYMENT_REJECTED: `မင်္ဂလာပါ ${input.customerName}၊\n${order} အတွက် ပေးပို့ထားသော ငွေပေးချေမှု အထောက်အထားကို အတည်ပြု၍ မရသေးပါ။${input.rejectionReason ? `\nအကြောင်းပြချက်: ${input.rejectionReason}` : ''}\nကျေးဇူးပြု၍ အထောက်အထားအသစ်ကို ပြန်လည်ပေးပို့ပါ။`,
      DELIVERY_PROCESSING: `မင်္ဂလာပါ ${input.customerName}၊\n${order} အတွက် Digital Product access ကို ပြင်ဆင်ပေးနေပါပြီ။ ခဏအတွင်း CS team မှ ဆက်သွယ်ပေးပါမယ်။`,
      DELIVERY_COMPLETED: `မင်္ဂလာပါ ${input.customerName}၊\n${order} အတွက် Digital Product Delivery ပြီးမြောက်ပါပြီ။${input.deliveryReference ? `\nReference: ${input.deliveryReference}` : ''}${input.expiryDate ? `\nသက်တမ်းကုန်ဆုံးမည့်ရက်: ${input.expiryDate}` : ''}${tracking}`,
      DELIVERY_FAILED: `မင်္ဂလာပါ ${input.customerName}၊\n${order} အတွက် Delivery ကို ဆက်လက်လုပ်ဆောင်ရန် အကူအညီလိုအပ်နေပါသည်။${input.failureReason ? `\nအကြောင်းပြချက်: ${input.failureReason}` : ''}\nCS team မှ ဆက်သွယ်ပေးပါမယ်။`,
    };
    return { subject: subjects[input.eventType], body: bodies[input.eventType], payload };
  }

  const subjects: Record<CustomerNotificationEvent, string> = {
    PAYMENT_PROOF_RECEIVED: `Payment proof received — ${order}`,
    PAYMENT_VERIFIED: `Payment verified — ${order}`,
    PAYMENT_REJECTED: `Payment proof needs attention — ${order}`,
    DELIVERY_PROCESSING: `Your digital product is being prepared — ${order}`,
    DELIVERY_COMPLETED: `Digital product delivered — ${order}`,
    DELIVERY_FAILED: `Delivery support needed — ${order}`,
  };
  const bodies: Record<CustomerNotificationEvent, string> = {
    PAYMENT_PROOF_RECEIVED: `Hello ${input.customerName},\nWe received your payment proof for ${order} (${amount}). Our Owner team will review it and send you the next update.`,
    PAYMENT_VERIFIED: `Hello ${input.customerName},\nYour payment of ${amount} for ${order} has been verified. Our delivery team will prepare your digital access.`,
    PAYMENT_REJECTED: `Hello ${input.customerName},\nWe could not verify the payment proof for ${order}.${input.rejectionReason ? `\nReason: ${input.rejectionReason}` : ''}\nPlease send a new, clear proof to continue.`,
    DELIVERY_PROCESSING: `Hello ${input.customerName},\nYour digital product access for ${order} is being prepared. Our CS team will contact you shortly.`,
    DELIVERY_COMPLETED: `Hello ${input.customerName},\nYour digital product delivery for ${order} is complete.${input.deliveryReference ? `\nReference: ${input.deliveryReference}` : ''}${input.expiryDate ? `\nExpiry date: ${input.expiryDate}` : ''}${tracking}`,
    DELIVERY_FAILED: `Hello ${input.customerName},\nWe need support follow-up to complete delivery for ${order}.${input.failureReason ? `\nReason: ${input.failureReason}` : ''}\nOur CS team will contact you shortly.`,
  };
  return { subject: subjects[input.eventType], body: bodies[input.eventType], payload };
}
