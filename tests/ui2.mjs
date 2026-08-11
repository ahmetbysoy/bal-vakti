import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
const issues = [];
page.on('pageerror', (e) => issues.push('PAGEERROR: ' + String(e).slice(0, 120)));
await page.goto('http://localhost:8787/', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
await page.waitForSelector('#loader', { state: 'hidden', timeout: 20000 }).catch(() => {});
await page.waitForTimeout(2500);

// ── 1) Günlük Ödül modalı: NaN var mı? ──
await page.evaluate(() => { document.querySelector('nav button[data-tab="kovan"]').click(); });
await page.waitForTimeout(800);
await page.evaluate(() => { document.getElementById('btn-daily').click(); });
await page.waitForTimeout(600);
const daily = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('#modal-body .btn')].find((b) => b.textContent.includes('Ödülü Al'));
  return btn ? btn.textContent : 'buton yok';
});
console.log('🎁 Günlük Ödül butonu:', daily);
if (daily.includes('NaN')) issues.push('NaN bug: ' + daily);
await page.evaluate(() => { const c = document.querySelector('.overlay.show .close'); if (c) c.click(); });

// ── 2) Toast yığılması testi: hızlı Topla x6 ──
await page.evaluate(() => {
  for (let i = 0; i < 6; i++) toast('test toast ' + i);
});
await page.waitForTimeout(300);
const toastCount = await page.evaluate(() => document.getElementById('toasts').children.length);
console.log('🍞 Toast sayısı (6 atıldı, max 3 olmalı):', toastCount);
if (toastCount > 3) issues.push('Toast yığılması: ' + toastCount + ' görünür');
await page.waitForTimeout(2800);

// ── 3) FOMO katlanır ──
await page.evaluate(() => { document.getElementById('fomo-panel').style.display = 'block'; });
const fomoState = await page.evaluate(() => {
  const body = document.getElementById('fomo-body');
  return body ? body.style.display : 'yok';
});
console.log('🔥 FOMO varsayılan:', fomoState, '(none = kapalı ✅)');
if (fomoState !== 'none') issues.push('FOMO varsayılan açık!');

// ── 4) Hero yan yana + Topla yuvarlak ──
const hero = await page.evaluate(() => {
  const btn = document.getElementById('btn-collect');
  const r = btn.getBoundingClientRect();
  return { top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), round: r.width > 70 && r.height > 70 };
});
console.log('🏠 Topla butonu:', JSON.stringify(hero));
if (hero.top > 420) issues.push('Hero altta: ' + hero.top);

// ── 5) Tab gezintisi (savaş + eglence dolu mu) ──
for (const [id, name] of [['savas','Savaş'], ['eglence','Eğlence'], ['lb','Lig']]) {
  await page.evaluate((tid) => document.querySelector('nav button[data-tab="' + tid + '"]').click(), id);
  await page.waitForTimeout(3500);
  const info = await page.evaluate(() => ({
    enemies: document.querySelectorAll('#tab-savas .enemy').length,
    games: document.querySelectorAll('#tab-eglence .gbtn').length,
    rows: document.querySelectorAll('#tab-lb .lrow').length,
    mybar: document.getElementById('myrankbar') ? document.getElementById('myrankbar').style.display : 'yok',
  }));
  console.log('🎯 ' + name + ':', JSON.stringify(info));
}
await page.screenshot({ path: 'screenshots/v3-kovan.png' });
console.log(issues.length ? '🔴 SORUNLAR: ' + JSON.stringify(issues) : '✅ 0 SORUN');
await browser.close();
