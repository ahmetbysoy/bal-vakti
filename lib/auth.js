// 🔐 Bal Vakti — Telegram WebApp initData doğrulaması
// initData, Telegram tarafından imzalanır; hash'i bot token'ıyla doğrularız.
// Kaynak: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

import crypto from 'crypto';

export function parseInitData(initData) {
  if (!initData || typeof initData !== 'string') return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN || '').digest();
  const computed = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computed !== hash) return null;

  let user = {};
  try {
    user = JSON.parse(params.get('user') || '{}');
  } catch {
    return null;
  }
  return { user, startParam: params.get('start_param') };
}
