# AI Tools By David Business OS

Own CRM + POS MVP for AI Tools By David Digital Store.

## Services

- `apps/web` — responsive frontend dashboard
- `apps/api` — Fastify API and health endpoint
- `apps/worker` — background worker and scheduled jobs
- `database/` — PostgreSQL migrations and seed data

## Render deployment shape

- Static Site: `apps/web`
- Web Service: `apps/api`
- Background Worker: `apps/worker`
- Cron Job: `apps/worker` with the `cron` command
- PostgreSQL: Render Postgres
- Private object storage: configure an S3-compatible provider for payment proofs

## Local start

```bash
cp .env.example .env
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

API health: <http://localhost:10000/health>  
Frontend: <http://localhost:5173>

## Important MVP safety rules

- Payment proof is not payment verification.
- Only Owner/Operations roles can verify payment.
- Delivery is only allowed for `payment_status=VERIFIED`.
- Never store passwords, OTPs, recovery codes, or wallet secrets.
- Do not commit `.env` or production tokens.
