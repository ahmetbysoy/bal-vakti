import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
const issues = [];
page.on('pageerror', (e) => issues.push('PAGEERROR: ' + String(e).slice(0, 120)));
await page.goto('http://localhost:8787/', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
await page.waitForSelector('#loader', { state: 'hidden', timeout: 20000 }).catch(() => {});
await page.waitForTimeout(2500);

// 1) Kovan: sekmeli kart (Genel/Yükseltmeler)
const tabs = await page.evaluate(() => {
  const bts = [...document.querySelectorAll('.sec-tabs .st')].map((b) => b.textContent.trim());
  const genelVisible = document.getElementById('sec-genel').style.display !== 'none';
  return { bts, genelVisible };
});
console.log('📊 Kovan sekmeler:', JSON.stringify(tabs));
if (!tabs.bts.includes('📊 Genel') || !tabs.bts.includes('🏭 Yükseltmeler')) issues.push('Kovan sekmesi yok');

// Genel → Yükseltmeler geçişi
await page.evaluate(() => secTab('upg'));
const upgVisible = await page.evaluate(() => document.getElementById('sec-upg').style.display !== 'none' && document.getElementById('sec-genel').style.display === 'none');
console.log('🏭 Yükseltmeler geçişi:', upgVisible ? '✅' : '❌');
if (!upgVisible) issues.push('Yükseltmeler sekmesi açılmıyor');
await page.evaluate(() => secTab('genel'));

// 2) Arılar: ilerleme göstergesi
await page.evaluate(() => document.querySelector('nav button[data-tab="bees"]').click());
await page.waitForTimeout(1200);
const beeProg = await page.evaluate(() => document.querySelectorAll('.bee-prog').length);
console.log('🐝 Arı ilerleme barı sayısı:', beeProg);
if (beeProg === 0) issues.push('Arı ilerleme göstergesi yok');

// 3) Savaş: alt-sekmeler
await page.evaluate(() => document.querySelector('nav button[data-tab="savas"]').click());
await page.waitForTimeout(3500);
const raidSecs = await page.evaluate(() => {
  const bts = [...document.querySelectorAll('.sec-tabs [data-rs]')].map((b) => b.textContent.trim());
  return { bts, kinVisible: document.getElementById('rs-kin').style.display !== 'none' };
});
console.log('⚔️ Savaş alt-sekmeler:', JSON.stringify(raidSecs));
if (!raidSecs.bts.includes('😠 Kin') || !raidSecs.bts.includes('🌍 Dünya')) issues.push('Savaş alt-sekme yok');
// Dünya sekmesine geç
await page.evaluate(() => raidSecTab('dunya'));
const dunyaOk = await page.evaluate(() => document.getElementById('rs-dunya').style.display !== 'none');
console.log('🌍 Dünya sekmesi:', dunyaOk ? '✅' : '❌');
if (!dunyaOk) issues.push('Dünya sekmesi açılmıyor');

// 4) Layout kontrolü (yatay taşma)
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
console.log('📐 Yatay taşma:', overflow ? '❌ VAR' : '✅ yok');
if (overflow) issues.push('Yatay taşma');

await page.screenshot({ path: 'screenshots/v33-savas.png' });
console.log(issues.length ? '🔴 SORUNLAR: ' + JSON.stringify(issues) : '✅ TÜM YENİ ÖZELLİKLER ÇALIŞIYOR');
await browser.close();
