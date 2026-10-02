# Platform Sources Used for Deployment Preparation

These are the official platform documents used to shape the Render deployment scaffold.

- Render Web Services: https://render.com/docs/web-services
  - Git provider or Docker deployment, public web services, private networking, health checks, environment variables, custom domains, and port binding.
- Render Postgres: https://render.com/docs/postgresql-creating-connecting
  - Managed PostgreSQL, same-region internal connection URL, backups/recovery options, and private connectivity.
- Render Background Workers: https://render.com/docs/background-workers
  - Continuous worker services for queue-based asynchronous jobs.
- Render Cron Jobs: https://render.com/docs/cronjobs
  - Scheduled jobs use UTC and should exit after completing their task; cron jobs cannot use persistent disks.
- Railway Quick Start: https://docs.railway.com/quick-start
  - GitHub, CLI, Docker image, and template deployment paths.
- Railway PostgreSQL: https://docs.railway.com/guides/postgresql
  - PostgreSQL service provisioning and service environment variables; the template requires the project owner to manage configuration and maintenance.
- Railway Volumes: https://docs.railway.com/volumes
  - Persistent volume mount behavior and deployment-time availability.
- Railway Cron Jobs: https://docs.railway.com/guides/cron-jobs
  - Scheduled services must terminate after the task; schedules use UTC and a prior active run can cause the next run to be skipped.
