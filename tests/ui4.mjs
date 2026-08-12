import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
const issues = [];
page.on('pageerror', (e) => issues.push('PAGEERROR: ' + String(e).slice(0, 120)));
await page.goto('http://localhost:8787/', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
await page.waitForSelector('#loader', { state: 'hidden', timeout: 20000 }).catch(() => {});
await page.waitForTimeout(2500);

// 1) Sandık modalı
await page.evaluate(() => document.querySelector('nav button[data-tab="eglence"]').click());
await page.waitForTimeout(1500);
const games = await page.evaluate(() => [...document.querySelectorAll('#tab-eglence .gbtn b')].map((b) => b.textContent));
console.log('🎰 Eğlence oyunları:', JSON.stringify(games));
if (!games.includes('Günlük Sandık')) issues.push('Sandık yok');
if (games.includes('Yazı-Tura') || games.includes('Slot')) issues.push('KUMAR HÂLÂ VAR!');

await page.evaluate(() => { const b = [...document.querySelectorAll('#tab-eglence .gbtn')].find((x) => x.textContent.includes('Sandık')); if (b) b.click(); });
await page.waitForTimeout(600);
const chestCards = await page.evaluate(() => document.querySelectorAll('.chest-card').length);
console.log('🎁 Sandık kartları:', chestCards);
if (chestCards !== 3) issues.push('Sandık 3 kart değil: ' + chestCards);
await page.evaluate(() => { const c = document.querySelector('.overlay.show .close'); if (c) c.click(); });

// 2) Streak badge
const streak = await page.evaluate(() => document.getElementById('streak-badge') ? document.getElementById('streak-badge').style.display : 'yok');
console.log('🔥 Streak badge durumu:', streak);

// 3) nav syntax (HTML parser)
const navOk = await page.evaluate(() => !!document.querySelector('nav'));
console.log('📐 nav tag:', navOk ? '✅ var' : '❌ YOK');
if (!navOk) issues.push('nav yok');

// 4) Hologram/neon varlığı
const holoCss = await page.evaluate(() => !!document.querySelector('style').textContent.includes('holo'));
console.log('🌈 Hologram CSS:', holoCss ? '✅' : '❌');

await page.screenshot({ path: 'screenshots/v5-eglence.png' });
console.log(issues.length ? '🔴 SORUNLAR: ' + JSON.stringify(issues) : '✅ v5 DOPAMİN SÜRÜMÜ HAZIR');
await browser.close();
