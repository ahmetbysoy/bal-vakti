import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console:', m.type(), m.text().slice(0, 200)); });
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 200)));
await page.goto('http://localhost:8787/', { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => console.log('goto err', e.message));
await page.waitForTimeout(2000);
const info = await page.evaluate(() => ({
  navCount: document.querySelectorAll('nav').length,
  bodyStart: document.body.innerHTML.slice(0, 300),
  hasTabs: !!document.querySelector('[data-tab="kovan"]'),
}));
console.log(JSON.stringify(info, null, 1));
await browser.close();
