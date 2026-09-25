# 🏪 Telegram Bot Store

متجر/دليل حديث لاكتشاف بوتات Telegram من Mini App واحدة، مع بحث، تصنيفات، تقييمات، مفضلة، اقتراح بوتات، تقارير، دعم فني، طلبات بحث، وإدارة من Termux.

## تشغيل محليًا على Termux

```bash
pkg update -y
pkg install nodejs -y
cd telegram-bot-store
npm install
cp .env.example .env
npm run seed
npm run check
npm test
npm start
```

افتح: `http://127.0.0.1:8787`

## Telegram

1. أنشئ Bot عبر BotFather.
2. ضع `BOT_TOKEN` في `.env`.
3. اجعل `WEBAPP_URL` رابط HTTPS للواجهة عند النشر.
4. شغّل `npm run bot`.

> Mini App تحتاج HTTPS عند استخدامها من Telegram. للتطوير المحلي استخدم نفق HTTPS موثوق أو استضافة اختبار.

## Admin

```bash
npm run admin
```

## Seed

```bash
npm run seed
```

بيانات seed يجب أن تكون تجريبية فقط.

## التصميم

- Mobile First
- Dark/Light
- عربي RTL مع قابلية الإنجليزية
- REST API
- SQLite عبر sql.js
- Telegram WebApp authentication
- Rate limiting وvalidation وsecurity headers
- Backup وAudit Log

## ملاحظة أمنية

لا يحتاج المتجر إلى Bot Tokens للبوتات المدرجة؛ يخزن فقط بيانات العرض العامة. لا تضع أسرار Telegram داخل ملفات `public/`.


## Google video ads (IMA)
The Mini App supports Google IMA HTML5 video ads through a VAST-compatible ad tag. This is different from the native AdMob SDK used in Android/iOS apps. Google documents IMA for HTML5 and VAST-based ad playback. Configure `GOOGLE_IMA_ENABLED=1` and set `GOOGLE_IMA_VAST_TAG` to your own Google Ad Manager/compatible VAST tag before production. Keep ads disabled or use Google's test ad configuration during development. If no ad is available, the store continues directly to the Telegram bot.


## Authentication hardening
The Mini App exchanges Telegram `initData` for a short-lived server-side bearer session. Normal API requests accept only the session header; raw Telegram initData is accepted only by `/api/auth/telegram`. Sessions are stored as SHA-256 token hashes and expired sessions are pruned daily.


## التشغيل الآمن في الإنتاج
- استخدم HTTPS فقط خلف reverse proxy موثوق، واترك `HOST=127.0.0.1` إذا كان النفق/البروكسي هو الذي يواجه الإنترنت. عند الحاجة للاستماع على كل الواجهات استخدم `HOST=0.0.0.0` فقط خلف جدار حماية/proxy مناسب.
- لا تضبط `TRUST_PROXY=1` إلا إذا كان هناك proxy واحد تثق به ويعيد `X-Forwarded-For` بشكل صحيح.
- ضع `ADMIN_TELEGRAM_IDS` كقائمة Telegram numeric IDs، وليس usernames.
- احتفظ بملف `.env` خارج Git ولا تضع `BOT_TOKEN` في `public/`.
- النسخ الاحتياطية تُحفظ داخل مجلد `backups` بجانب قاعدة البيانات وليست ضمن `public/`.
- قاعدة البيانات الحالية تعتمد `sql.js` داخل عملية Node واحدة؛ لا تشغّل عدة نسخ من السيرفر على نفس ملف SQLite.
