import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
const issues = [];
page.on('pageerror', (e) => issues.push('PAGEERROR: ' + String(e).slice(0, 120)));
await page.goto('http://localhost:8787/', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
await page.waitForSelector('#loader', { state: 'hidden', timeout: 20000 }).catch(() => {});
await page.waitForTimeout(2500);
// Eğlence: mini oyunlar görünüyor mu
await page.evaluate(() => document.querySelector('nav button[data-tab="eglence"]').click());
await page.waitForTimeout(1500);
const games = await page.evaluate(() => [...document.querySelectorAll('#tab-eglence .gbtn b')].map((b) => b.textContent));
console.log('🎪 Eğlence oyunları:', JSON.stringify(games));
if (!games.includes('Balon') || !games.includes('Zamanlayıcı')) issues.push('Mini oyunlar yok');
// Balon oyununu aç
await page.evaluate(() => { const b = [...document.querySelectorAll('#tab-eglence .gbtn')].find((x) => x.textContent.includes('Balon')); if (b) b.click(); });
await page.waitForTimeout(800);
const field = await page.evaluate(() => !!document.getElementById('balloon-field'));
console.log('🎈 Balon alanı:', field ? '✅' : '❌');
if (!field) issues.push('Balon alanı yok');
// Balonlara tıkla
const popped = await page.evaluate(() => {
  const bs = document.querySelectorAll('.balloon');
  let n = 0;
  bs.forEach((b) => { b.click(); n++; });
  return n;
});
console.log('💥 Tıklanan balon:', popped);
await page.screenshot({ path: 'screenshots/v6-balon.png' });
await page.evaluate(() => { const c = document.querySelector('.overlay.show .close'); if (c) c.click(); });
console.log(issues.length ? '🔴 SORUNLAR: ' + JSON.stringify(issues) : '✅ v6.0 MİNİ OYUNLAR HAZIR');
await browser.close();
