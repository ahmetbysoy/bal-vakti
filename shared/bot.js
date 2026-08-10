// 🤖 POST /api/bot — Telegram bot webhook'u (Telegraf)
// Bot sadece kapı: /start ile karşılama + Mini App butonu.
// Oyunun kendisi Mini App'te (index.html) çalışır.
import { Telegraf, Markup } from 'telegraf';

const token = process.env.BOT_TOKEN;
const appUrl = process.env.APP_URL;
const bot = token ? new Telegraf(token) : null;

if (bot) {
  bot.start(async (ctx) => {
    const kb = Markup.inlineKeyboard([
      [Markup.button.webApp('🎮 Oyunu Aç', appUrl)],
    ]);
    await ctx.reply(
      `🐝 Hoş geldin, ${ctx.from.first_name}!\n\n` +
        `Bal Vakti: arı al 🐝, birleştir ✨, bal üret 🍯, rozet topla 🏅, arkadaşlarınla yarış! 🏆\n\n` +
        `💰 Para yok, sadece eğlence. Hemen başla 👇`,
      kb
    );
    try {
      await ctx.telegram.setChatMenuButton({
        chat_id: ctx.chat.id,
        menu_button: { type: 'web_app', text: '🎮 Oyna', web_app: { url: appUrl } },
      });
    } catch (e) {
      /* menü butonu set edilemezse sorun değil */
    }
  });

  bot.command('oyna', (ctx) =>
    ctx.reply('Oyunu aç 👇', Markup.inlineKeyboard([[Markup.button.webApp('🎮 Oyna', appUrl)]]))
  );

  bot.command('admin', (ctx) => {
    const uid = String(ctx.from.id);
    const owner = process.env.OWNER_ID;
    if (!owner) {
      return ctx.reply(
        `👑 Tanrı Modu kurulmamış.\n\nSenin Telegram ID'n: <code>${uid}</code>\n` +
        `Bu ID'yi Vercel ortam değişkenlerine <b>OWNER_ID</b> olarak ekle (veya ADMIN_PASSWORD belirle) ve redeploy et.`,
        { parse_mode: 'HTML' }
      );
    }
    if (uid !== owner) return ctx.reply('⛔ Bu komut yalnızca bot sahibine özeldir.');
    ctx.reply(
      '👑 Tanrı Modu — oyuncu yönetimi, bonuslar, canlı ekonomi ayarları.',
      Markup.inlineKeyboard([[Markup.button.webApp('👑 Admin Panel', appUrl + '/admin.html')]])
    );
  });

  bot.help((ctx) =>
    ctx.reply(
      '🐝 Bal Vakti komutları:\n' +
        '/start — karşılama + oyunu aç\n' +
        '/oyna — oyunu aç\n' +
        '/admin — tanrı modu (yalnızca sahip)\n\n' +
        'Arkadaşlarını davet et, ikiniz de bonus bal kazanın! 🎁'
    )
  );
}

export async function route(req, res) {
  if (req.method === 'POST') {
    if (!bot) return res.status(500).json({ error: 'BOT_TOKEN tanımlı değil' });
    try {
      await bot.handleUpdate(req.body, res);
    } catch (e) {
      console.error('Webhook hatası:', e);
      if (!res.headersSent) res.status(500).json({ error: 'webhook_hatasi' });
    }
    return;
  }
  res.status(200).json({ ok: true, bot: !!bot, appUrl: appUrl || null });
}
