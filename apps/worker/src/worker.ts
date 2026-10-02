import 'dotenv/config';

const intervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 10_000);
let running = true;

console.log('AI Tools By David worker started', {
  mode: process.env.NODE_ENV ?? 'development',
  intervalMs,
});

async function poll() {
  if (!running) return;
  // TODO: connect to the queue and process webhook/message/notification jobs.
  // Keep payment verification and delivery as explicit Owner/CS actions.
}

const timer = setInterval(() => {
  void poll();
}, intervalMs);

function shutdown(signal: string) {
  console.log(`Worker received ${signal}; shutting down.`);
  running = false;
  clearInterval(timer);
  setTimeout(() => process.exit(0), 100);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
