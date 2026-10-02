import 'dotenv/config';
import { closeNotificationPool, processNotificationOutbox } from './notifications.js';

console.log('AI Tools By David scheduled notification job started');
try {
  const processed = await processNotificationOutbox();
  console.log(`AI Tools By David scheduled notification job completed; processed=${processed}`);
} finally {
  await closeNotificationPool();
}
