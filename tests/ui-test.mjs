// 🧪 Bal Vakti — Kapsamlı UI/UX testi (Playwright, 375px mobil)
// Tüm 7 tab: overlap, metin taşması, dikey akış, kesik element kontrolü
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';

const BASE = 'http://localhost:8787';
const VIEWPORT = { width: 375, height: 812 };
mkdirSync('screenshots', { recursive: true });

const issues = [];
function logIssue(tab, type, msg) {
  issues.push({ tab, type, msg });
  console.log(`  🔴 [${tab}] ${type}: ${msg}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
page.on('console', (m) => { if (m.type() === 'error') console.log('  ⚠️ console.error:', m.text().slice(0, 120)); });
page.on('pageerror', (e) => console.log('  ⚠️ pageerror:', String(e).slice(0, 160)));

console.log('📱 Yükleniyor...');
await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => console.log('goto hata:', e.message));
await page.waitForSelector('#loader', { state: 'hidden', timeout: 20000 }).catch(() => {});
await page.waitForTimeout(2500);

// ── Genel layout kontrolleri ──
async function layoutCheck(tabName) {
  const r = await page.evaluate(() => {
    const issues = [];
    const doc = document.documentElement;
    // 1) Yatay taşma
    if (doc.scrollWidth > doc.clientWidth + 2) {
      issues.push({ type: 'yatay_tasma', msg: `scrollWidth=${doc.scrollWidth} > clientWidth=${doc.clientWidth}` });
    }
    // 2) Metin taşan elemanlar (görünür, metin içeren)
    const all = document.querySelectorAll('button, span, b, div, a, p, h1, h2, h3, h4');
    for (const el of all) {
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || el.offsetWidth === 0) continue;
      // sadece görünür alanda
      const rect = el.getBoundingClientRect();
      if (rect.bottom < -10 || rect.top > window.innerHeight + 10) continue;
      if (el.scrollWidth > el.clientWidth + 2) {
        const txt = (el.textContent || '').trim().slice(0, 40);
        if (txt) {
          // white-space normal olan ve yatay taşan metin → sorun
          if (st.whiteSpace !== 'nowrap' && st.overflowX === 'visible') {
            issues.push({ type: 'metin_tasmasi', msg: `<${el.tagName}> "${txt}" scrollW=${el.scrollWidth} clientW=${el.clientWidth}` });
          }
        }
      }
      // 3) Dikey metin akışı: linkbox gibi — metin her karakterde satır atlıyorsa
      if (el.scrollHeight > el.clientHeight * 4 && el.clientHeight > 0) {
        const txt = (el.textContent || '').trim().slice(0, 30);
        if (txt && txt.length > 20) {
          issues.push({ type: 'dikey_akis', msg: `<${el.tagName}> "${txt}..." yükseklik: ${el.clientHeight}->${el.scrollHeight}` });
        }
      }
    }
    return issues;
  });
  for (const i of r) logIssue(tabName, i.type, i.msg);
}

// ── Tab gezintisi ──
const tabs = [
  ['kovan', 'Kovan'],
  ['bees', 'Arılar'],
  ['savas', 'Savaş'],
  ['eglence', 'Eğlence'],
  ['achs', 'Rozetler'],
  ['lb', 'Lig'],
  ['me', 'Ben'],
];

for (const [id, label] of tabs) {
  console.log(`\n🎯 TAB: ${label}`);
  // tıkla (nav butonu varsa)
  const clicked = await page.evaluate((tid) => {
    const btn = document.querySelector(`nav button[data-tab="${tid}"]`);
    if (btn) { btn.click(); return true; }
    return false;
  }, id);
  if (!clicked) { logIssue(label, 'tab_yok', `nav button[data-tab=${id}] bulunamadı`); continue; }
  await page.waitForTimeout(3500); // animasyon + veri yükleme (bot beyni dahil)

  await layoutCheck(label);

  // Tab'a özel kontroller
  if (id === 'kovan') {
    // Hero üstte mi? (Topla butonu görünür, yükseklik < 400)
    const hero = await page.evaluate(() => {
      const btn = document.getElementById('btn-collect');
      if (!btn) return { yok: true };
      const r = btn.getBoundingClientRect();
      return { top: Math.round(r.top), visible: r.top >= 0 && r.bottom <= window.innerHeight };
    });
    if (hero.yok) logIssue(label, 'hero_yok', 'Topla butonu bulunamadı');
    else if (hero.top > 420) logIssue(label, 'hero_altta', `Topla butonu ekranın ${hero.top}px'inde (ilk ekranda değil)`);
    else console.log(`  ✅ Topla butonu ilk ekranda (${hero.top}px)`);
  }
  if (id === 'savas') {
    await page.waitForTimeout(1500); // world yüklenirken ekstra bekleme
    // XP kartı kesik mi? Hedef kartlar görünür mü?
    const r = await page.evaluate(() => {
      const warLvl = document.getElementById('war-lvl');
      const targets = document.getElementById('raid-targets');
      const enemies = document.querySelectorAll('.enemy');
      const tRect = targets ? targets.getBoundingClientRect() : null;
      return {
        warVisible: warLvl ? warLvl.getBoundingClientRect().top < window.innerHeight : false,
        targetTop: tRect ? Math.round(tRect.top) : null,
        enemyCount: enemies.length,
      };
    });
    console.log(`  ℹ️ XP kartı görünür: ${r.warVisible} | hedef kart top: ${r.targetTop} | düşman: ${r.enemyCount}`);
  }
  if (id === 'eglence') {
    const r = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#tab-eglence .gbtn')];
      return { count: btns.length, firstVisible: btns.length ? btns[0].getBoundingClientRect().top < window.innerHeight : false };
    });
    console.log(`  ℹ️ Eğlence butonları: ${r.count} | ilki görünür: ${r.firstVisible}`);
  }
  if (id === 'lb') {
    await page.waitForTimeout(1500); // leaderboard yüklenirken ekstra bekleme
    const r = await page.evaluate(() => {
      const bar = document.getElementById('myrankbar');
      return { barVisible: bar ? bar.style.display !== 'none' : false, rows: document.querySelectorAll('.lrow').length };
    });
    console.log(`  ℹ️ Alt sabit bar: ${r.barVisible} | satır: ${r.rows}`);
  }

  await page.screenshot({ path: `screenshots/tab-${id}.png`, fullPage: false });
  console.log(`  📸 screenshots/tab-${id}.png`);
}

// ── Davet modalı: linkbox dikey akış kontrolü ──
console.log('\n🎯 DAVET MODALI');
await page.evaluate(() => { const b = document.querySelector('nav button[data-tab="kovan"]'); if (b) b.click(); });
await page.waitForTimeout(800);
await page.evaluate(() => { const b = document.querySelector('.toprow .iconbtn'); if (b) b.click(); });
await page.waitForTimeout(600);
const inv = await page.evaluate(() => {
  const lb = document.getElementById('invlink');
  if (!lb) return { yok: true };
  const r = lb.getBoundingClientRect();
  return {
    w: Math.round(r.width), h: Math.round(r.height),
    singleLine: r.height < 40,
    scrollW: lb.scrollWidth, clientW: lb.clientWidth,
    text: lb.textContent,
  };
});
if (inv.yok) logIssue('Davet', 'linkbox_yok', 'invlink bulunamadı');
else {
  console.log(`  ℹ️ linkbox: ${inv.w}x${inv.h} | tek satır: ${inv.singleLine} | scrollW=${inv.scrollW} clientW=${inv.clientW} | metin: ${inv.text}`);
  if (!inv.singleLine) logIssue('Davet', 'dikey_akis', 'Davet linki tek satırda değil! (yükseklik > 40)');
  else console.log('  ✅ Davet linki tek satır (dikey akış yok)');
}
await page.screenshot({ path: 'screenshots/modal-davet.png' });

// ── Ticker kontrolü ──
const tk = await page.evaluate(() => {
  const t = document.getElementById('ticker-track');
  if (!t) return { yok: true };
  const r = t.getBoundingClientRect();
  return { h: Math.round(r.height), text: (t.textContent || '').trim().slice(0, 60) };
});
console.log('\n🎯 TICKER');
if (tk.yok) logIssue('Ticker', 'yok', 'ticker-track bulunamadı');
else {
  console.log(`  ℹ️ yükseklik: ${tk.h}px | mesaj: "${tk.text}"`);
  if (tk.h > 40) logIssue('Ticker', 'cok_yuksek', `ticker ${tk.h}px — kesik/metin taşıyor olabilir`);
  else console.log('  ✅ Ticker tek satır');
}
await page.evaluate(() => { const ov = document.querySelector('.overlay.show .close'); if (ov) ov.click(); });

// ── Sonuç ──
console.log(`\n══════════════════════════════════`);
console.log(`📊 SONUÇ: ${issues.length} sorun tespit edildi`);
if (issues.length) {
  const byType = {};
  for (const i of issues) byType[i.type] = (byType[i.type] || 0) + 1;
  console.log('Tür dağılımı:', byType);
}
await browser.close();
