import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
const issues = [];
page.on('pageerror', (e) => issues.push('PAGEERROR: ' + String(e).slice(0, 120)));
await page.goto('http://localhost:8787/', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
await page.waitForSelector('#loader', { state: 'hidden', timeout: 20000 }).catch(() => {});
await page.waitForTimeout(2500);
// Onboarding görünüyor mu? (yeni oyuncu ise)
const ob = await page.evaluate(() => {
  const ov = document.getElementById('onboard-overlay');
  return ov ? ov.classList.contains('show') : false;
});
console.log('🎓 Onboarding:', ob ? '✅ gösteriliyor' : 'ℹ️ görünmüyor (önceden bitmiş olabilir)');
if (ob) {
  // adımları geç
  for (let i = 0; i < 3; i++) { await page.evaluate(() => obNext()); await page.waitForTimeout(300); }
  const closed = await page.evaluate(() => !document.getElementById('onboard-overlay').classList.contains('show'));
  console.log('🎓 Onboarding bitti:', closed ? '✅' : '❌');
  if (!closed) issues.push('Onboarding kapanmıyor');
}
// Quest hub
await page.waitForTimeout(500);
const hub = await page.evaluate(() => {
  const h = document.getElementById('quest-hub-items');
  return h ? h.children.length : 0;
});
console.log('🎯 Quest hub chip sayısı:', hub);
if (hub === 0) issues.push('Quest hub boş');
// Chip'e tıkla → modal açılıyor mu
await page.evaluate(() => { const c = document.querySelector('.hub-chip'); if (c) c.click(); });
await page.waitForTimeout(600);
const modalOpen = await page.evaluate(() => document.getElementById('overlay').classList.contains('show'));
console.log('🎯 Chip tıklama → modal:', modalOpen ? '✅' : '❌');
if (!modalOpen) issues.push('Quest hub chip çalışmıyor');
await page.screenshot({ path: 'screenshots/v64-onboard.png' });
console.log(issues.length ? '🔴 SORUNLAR: ' + JSON.stringify(issues) : '✅ v6.4 ONBOARDING + QUEST HUB HAZIR');
await browser.close();
