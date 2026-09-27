# Telegram Bot Store — Unified Final Build

هذه الحزمة تجمع المشروع الأساسي وواجهة Telegram Mini App ولوحة الإدارة ونظام الأدوات والفلاتر والملفات المساعدة والنسخ الاحتياطية الموجودة في المشروع.

## Included
- Telegram Mini App / storefront
- User profiles, preferences, notifications and activity
- Favorites, ratings, reports and support flows
- Admin dashboard with controlled management
- Tool/project metadata: type, language, environment, speed, quality, platform and requirements
- Project submission workflow with moderation states
- Upload safety baseline: size/type/signature/SHA-256 checks and private storage
- Security middleware, validation, rate limits and Telegram authentication checks
- Database migrations and indexes
- Existing backup/reference files under `BotStore_Backups_v0.0.2`

## Start
1. `cp .env.example .env`
2. Configure Telegram token, WebApp URL and the two admin IDs.
3. Set a long random `TELEGRAM_WEBHOOK_SECRET` in production.
4. `npm ci`
5. `npm run check-all`
6. `npm start`

## Validation performed
- `npm test`: 12/12 passed.
- `npm run check-all`: 12/12 checks passed.
- Dependency vulnerability audit could not contact npm registry in this execution environment, so no online vulnerability status is claimed.
