import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
const issues = [];
page.on('pageerror', (e) => issues.push('PAGEERROR: ' + String(e).slice(0, 120)));
await page.goto('http://localhost:8787/', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
await page.waitForSelector('#loader', { state: 'hidden', timeout: 20000 }).catch(() => {});
await page.waitForTimeout(3000);
// Görevler kartı
const quests = await page.evaluate(() => {
  const card = document.getElementById('quests-card');
  const rows = document.querySelectorAll('#quests-list .quest');
  return { card: !!card, rows: rows.length };
});
console.log('📋 Görevler:', JSON.stringify(quests));
if (!quests.card || quests.rows === 0) issues.push('Görevler görünmüyor');
// Sandık hâlâ var
await page.evaluate(() => document.querySelector('nav button[data-tab="eglence"]').click());
await page.waitForTimeout(1500);
const hasChest = await page.evaluate(() => [...document.querySelectorAll('#tab-eglence .gbtn b')].some((b) => b.textContent.includes('Sandık')));
console.log('🎁 Sandık:', hasChest ? '✅' : '❌');
if (!hasChest) issues.push('Sandık yok');
// MAX_LEVEL 10 kontrol (arı grid)
await page.evaluate(() => document.querySelector('nav button[data-tab="bees"]').click());
await page.waitForTimeout(1200);
const beeMax = await page.evaluate(() => {
  const lvs = [...document.querySelectorAll('#bee-grid .lv')].map((e) => parseInt(e.textContent));
  return Math.max(...lvs);
});
console.log('🐝 Max arı seviyesi:', beeMax, '(10 olmalı)');
if (beeMax > 10) issues.push('MAX_LEVEL hâlâ >10: ' + beeMax);
await page.screenshot({ path: 'screenshots/v51-quests.png' });
console.log(issues.length ? '🔴 SORUNLAR: ' + JSON.stringify(issues) : '✅ GÖREVLER + MAX_LEVEL 10 HAZIR');
await browser.close();
