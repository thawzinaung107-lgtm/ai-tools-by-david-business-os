# Render Deployment Notes

## Services

`render.yaml` defines:

- `atd-api` — Node web service
- `atd-worker` — background worker
- `atd-cron` — 15-minute scheduled job, UTC schedule
- `atd-web` — static frontend site
- `atd-postgres` — PostgreSQL database

## Before the first deploy

1. Push this repository to a private GitHub repository.
2. Create a Render Blueprint from the repository.
3. Set `CORS_ORIGIN` to the final frontend URL.
4. Set `VITE_API_BASE_URL` to the final API URL.
5. Configure Meta secrets only after the API health check is green.
6. Keep payment screenshots in private object storage; do not rely on local service disk for business records.
7. Run migrations, then seed the initial catalog. Seeded products are `PAUSED` and have zero prices until Owner approval.

## Required checks

```bash
curl https://<api-domain>/health
curl https://<api-domain>/ready
```

The `/ready` endpoint must not be marked healthy if PostgreSQL is unavailable.

## Important Render settings

- Keep API, worker, cron, and Postgres in the same Singapore region.
- Use the Render internal Postgres connection string for Render services.
- Store secrets as environment variables, not in Git.
- Cron schedules use UTC. The initial `*/15 * * * *` job is only a scaffold schedule.
- Do not activate a Product or accept live Orders until current price, warranty, terms, and delivery rules are configured.

## MVP deployment limitation

This repository is a deployment-ready scaffold, not the complete production business system yet. Authentication, Meta webhook processing, full CRM/POS mutations, private object storage adapter, and the complete role/permission middleware still need implementation before live customer traffic.
