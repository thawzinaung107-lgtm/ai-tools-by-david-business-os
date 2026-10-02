import 'dotenv/config';
import { closeNotificationPool, processNotificationOutbox } from './notifications.js';

const intervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 10_000);
let running = true;
let polling = false;

console.log('AI Tools By David worker started', {
  mode: process.env.NODE_ENV ?? 'development',
  intervalMs,
});

async function poll() {
  if (!running || polling) return;
  polling = true;
  try {
    await processNotificationOutbox();
  } catch (error) {
    console.error('[notification:poll:error]', error);
  } finally {
    polling = false;
  }
}

void poll();
const timer = setInterval(() => { void poll(); }, intervalMs);

async function shutdown(signal: string) {
  console.log(`Worker received ${signal}; shutting down.`);
  running = false;
  clearInterval(timer);
  while (polling) await new Promise((resolve) => setTimeout(resolve, 100));
  await closeNotificationPool();
  process.exit(0);
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
