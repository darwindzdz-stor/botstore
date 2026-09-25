import 'dotenv/config';
import { Bot, InlineKeyboard } from 'grammy';

if (!process.env.BOT_TOKEN) {
  throw new Error('BOT_TOKEN is required');
}

const bot = new Bot(process.env.BOT_TOKEN);

const url = process.env.WEBAPP_URL;

bot.command('start', async (ctx) => {
  if (!url) {
    return ctx.reply('Bot Store is configured, but WEBAPP_URL is missing.');
  }

  const adminIds = new Set(
    (process.env.ADMIN_TELEGRAM_IDS || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
  );

  const keyboard = new InlineKeyboard()
    .webApp('🚀 فتح المتجر', url);

  if (ctx.from?.id && adminIds.has(String(ctx.from.id))) {
    keyboard.row()
      .webApp('⚙️ لوحة التحكم', `${url.replace(/\/$/, '')}/admin`);
  }

  await ctx.reply(
    '🏪 مرحبًا بك في Bot Store\\n\\nاكتشف بوتات Telegram وابحث عنها من المتجر.',
    {
      reply_markup: keyboard
    }
  );
});

bot.command('help', (ctx) =>
  ctx.reply('استخدم /start لفتح المتجر.')
);

bot.catch((err) => {
  console.error('BOT_ERROR', err);
});

export { bot };
