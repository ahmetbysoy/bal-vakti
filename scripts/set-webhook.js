// ⚙️ Telegram webhook + menü butonu kurulumu
// Kullanım: BOT_TOKEN=... BOT_USERNAME=... APP_URL=https://proje.vercel.app WEBHOOK_SECRET=gizli node scripts/set-webhook.js
// Veya: .env dosyası doluysa: node --env-file=.env scripts/set-webhook.js

const token = process.env.BOT_TOKEN;
const appUrl = process.env.APP_URL;
const secret = process.env.WEBHOOK_SECRET || '';

if (!token || !appUrl) {
  console.error('❌ BOT_TOKEN ve APP_URL gerekli!');
  process.exit(1);
}

const base = `https://api.telegram.org/bot${token}`;

// 1) Webhook'u Vercel adresine bağla
const wbRes = await fetch(`${base}/setWebhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    url: `${appUrl}/api/bot`,
    secret_token: secret || undefined,
    allowed_updates: ['message'],
  }),
});
console.log('setWebhook →', await wbRes.json());

// 2) Sohbet giriş kutusunun yanına "🎮 Oyna" menü butonu ekle
const mbRes = await fetch(`${base}/setChatMenuButton`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    menu_button: { type: 'web_app', text: '🎮 Oyna', web_app: { url: appUrl } },
  }),
});
console.log('setChatMenuButton →', await mbRes.json());

// 3) Komut listesini tanımla
const cmdRes = await fetch(`${base}/setMyCommands`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    commands: [
      { command: 'start', description: 'Oyunu başlat' },
      { command: 'oyna', description: 'Oyunu aç' },
      { command: 'help', description: 'Yardım' },
    ],
  }),
});
console.log('setMyCommands →', await cmdRes.json());

console.log('\n✅ Tamam! Botu Telegram\'da dene: https://t.me/' + (process.env.BOT_USERNAME || '<botunuz>'));
