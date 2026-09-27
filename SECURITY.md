# Bot Store Security Baseline

## Production checklist

- Run behind HTTPS only.
- Set `NODE_ENV=production`.
- Set `TELEGRAM_AUTH_MAX_AGE=3600` (or lower if operationally acceptable).
- Keep `TRUST_PROXY=0` unless the deployment is actually behind a trusted reverse proxy; if enabled, configure the exact proxy topology rather than trusting arbitrary client headers.
- Keep `BOT_TOKEN` and `ADMIN_TELEGRAM_IDS` out of Git.
- Keep `data/` outside the public web root.
- Backups are written with restrictive file permissions and should also be protected by host/container permissions.
- Rotate the Telegram bot token immediately if it is ever exposed.
- Review `/api/admin/audit` regularly.
- Use `/api/admin/integrity` after restore or unexpected shutdown.

## Security model

Telegram Web App `initData` is verified server-side using HMAC and a bounded `auth_date`. Admin access additionally requires the Telegram user ID to be present in `ADMIN_TELEGRAM_IDS`.

State-changing admin operations are rate limited. Bot deletion is a soft archive first; permanent purge requires the bot to already be archived and an ID-specific confirmation.

## Known operational limits

The application uses an in-memory `sql.js` database persisted to a SQLite file. It is suitable for a small deployment, but high concurrency or multiple application processes require moving to a server database (for example D1/Postgres) rather than sharing one SQLite file.

No security audit can prove absence of all vulnerabilities. Before production, run dependency auditing and dynamic tests in the actual deployment environment.
