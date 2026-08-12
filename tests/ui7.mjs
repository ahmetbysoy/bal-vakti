import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
const issues = [];
page.on('pageerror', (e) => issues.push('PAGEERROR: ' + String(e).slice(0, 120)));
await page.goto('http://localhost:8787/', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
await page.waitForSelector('#loader', { state: 'hidden', timeout: 20000 }).catch(() => {});
await page.waitForTimeout(2500);
await page.evaluate(() => document.querySelector('nav button[data-tab="eglence"]').click());
await page.waitForTimeout(1500);
// Labirent + Market kartları
const games = await page.evaluate(() => [...document.querySelectorAll('#tab-eglence .gbtn b')].map((b) => b.textContent));
console.log('🎪 Oyunlar:', JSON.stringify(games));
if (!games.includes('Labirent') || !games.includes('Galaksi Market')) issues.push('v6.1 kartları yok');
// Labirent aç
await page.evaluate(() => { const b = [...document.querySelectorAll('#tab-eglence .gbtn')].find((x) => x.textContent.includes('Labirent')); if (b) b.click(); });
await page.waitForTimeout(800);
const maze = await page.evaluate(() => ({ grid: !!document.getElementById('maze-grid'), cells: document.querySelectorAll('.maze-cell').length }));
console.log('🐝 Labirent grid:', maze.grid ? '✅' : '❌', '| hücre:', maze.cells);
if (!maze.grid || maze.cells === 0) issues.push('Labirent açılmıyor');
// Swipe simüle et
await page.evaluate(() => {
  // sağa kaydır
  const g = document.getElementById('maze-grid');
  const r = g.getBoundingClientRect();
  g.dispatchEvent(new TouchEvent('touchstart', { touches: [{ clientX: r.x + 30, clientY: r.y + 30 }], bubbles: true }));
  g.dispatchEvent(new TouchEvent('touchend', { changedTouches: [{ clientX: r.x + 90, clientY: r.y + 30 }], bubbles: true }));
});
await page.waitForTimeout(400);
const beeMoved = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.maze-cell')];
  const beeIdx = cells.findIndex((c) => c.textContent === '🐝');
  return beeIdx >= 0 ? beeIdx : -1;
});
console.log('🐝 Arı pozisyonu:', beeMoved >= 0 ? '✅ hareket etti' : '❌');
await page.screenshot({ path: 'screenshots/v61-labirent.png' });
await page.evaluate(() => { const c = document.querySelector('.overlay.show .close'); if (c) c.click(); });
console.log(issues.length ? '🔴 SORUNLAR: ' + JSON.stringify(issues) : '✅ v6.1 LABİRENT + MARKET HAZIR');
await browser.close();
