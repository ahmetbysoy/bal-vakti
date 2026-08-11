import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
page.on('console', (m) => console.log('console:', m.type(), m.text().slice(0, 150)));
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 200)));
await page.goto('http://localhost:8787/', { waitUntil: 'networkidle' });
await page.waitForSelector('#loader', { state: 'hidden', timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2000);
// Savaş sekmesine geç
await page.evaluate(() => { document.querySelector('nav button[data-tab="savas"]').click(); });
await page.waitForTimeout(3000);
const r = await page.evaluate(async () => {
  const out = {};
  out.mode = window.mode;
  out.raidData = window.raidData ? { targets: window.raidData.targets?.length, myWar: window.raidData.myWar } : null;
  out.targetsHtml = (document.getElementById('raid-targets') || {}).innerHTML?.slice(0, 200);
  out.errors = [];
  try {
    const resp = await fetch('/api/raid', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ demo: true, action: 'world' }) });
    const j = await resp.json();
    out.apiOk = j.ok;
    out.apiTargets = j.world?.targets?.length;
    out.apiError = j.error;
  } catch (e) { out.errors.push(String(e)); }
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
