// 🐝 Bal Vakti — TEK DOSYALIK API (otomatik üretildi: node scripts/bundle.js)
// Kaynak: shared/* ve shared/lib/* — lütfen bu dosyayı elle değiştirme!

import crypto from 'crypto';
import { Telegraf, Markup } from 'telegraf';

const __lib = {};
__lib['game'] = (() => {
// 🐝 Bal Vakti — oyun mantığı (saf fonksiyonlar)
// Tüm ekonomi burada; sunucu tarafı otoriteli (istemciye güvenilmez).
// NOT: Ekonomi değerleri DEFAULT_CONFIG üzerinden okunur. Admin paneli
// (lib/db.js → getConfig) bu değerleri canlı olarak değiştirebilir;
// sunucu her istekte setActiveCfg(await getConfig()) çağırır.

const MAX_LEVEL = 10; // 2^9=512 arı ile seviye 10 — çocuklar için ulaşılabilir

// ── Ekonomi parametreleri (varsayılan; admin paneli canlı değiştirebilir) ──
// ⚠️ CİMRİ EKONOMİ (v4): ilerleme yavaş ve istikrarlı olmalı
const DEFAULT_CONFIG = {
  beeBaseCost: 15,       // 1. seviye arı taban fiyatı
  beeCostGrowth: 1.15,   // her arıda fiyat %15 artar
  p1: 0.12,              // 1. seviye arı: bal/sn (saatte ~430 bal — 30sn'de 1 ödül)
  pMult: 3,               // her seviye 3x üretim (birleştirme değerli!)
  capBase: 400,          // başlangıç depo kapasitesi
  capUpgMult: 3,         // depo seviyesi başına 3x kapasite
  capUpgBase: 600,       // depo yükseltme taban fiyatı
  capUpgCostMult: 4,
  kovanBase: 1500,       // kovan (üretim x2) taban fiyatı
  kovanCostMult: 6,
  startBal: 20,          // yeni oyuncu başlangıç balı
  startFreeBees: 1,      // yeni oyuncuya ücretsiz arı
  vzvzTapReward: 2,      // VızVız: dokunuş başına 2 bal (combo x2/x3/x5 — frenzy 300 bal!)
  vzvzMaxTaps: 30,       // VızVız max dokunuş
  vzvzMaxMs: 10000,      // VızVız süresi: 10 sn (UI ile tutarlı)
  vzvzCooldownMs: 120000, // VızVız bekleme (2 dk)
  dailyEnabled: true,    // günlük ödül açık/kapalı
  vzvzEnabled: true,     // VızVız açık/kapalı
  maintenance: false,    // bakım modu (oyun kapanır)
};

// Aktif konfigürasyon (her istekte db.getConfig() ile set edilir)
let ACTIVE_CFG = DEFAULT_CONFIG;
function setActiveCfg(c) { ACTIVE_CFG = c || DEFAULT_CONFIG; }
function getActiveCfg() { return ACTIVE_CFG; }

const DAILY_REWARDS = [25, 50, 100, 200, 400, 800, 1500]; // 7 günlük seri
const REF_INVITER = 40;        // davet edenin ödülü
const REF_FRIEND = 20;         // davet edilenin ödülü
const VIZVIZ_MAX_MS = 12000;   // hile koruması: max süre (yedek sabit)
const VIZVIZ_COOLDOWN_MS = 2 * 60 * 1000; // yedek sabit (config ile uyumlu)

// ── Oyuncu durumu ──
function newState(now = Date.now()) {
  return {
    name: 'Arıcı',
    avatar: '🐝',
    bal: ACTIVE_CFG.startBal,
    totalEarned: 0,                  // ömür boyu kazanılan (sıralama/başarı için)
    beesOwned: ACTIVE_CFG.startFreeBees,
    bees: Array.from({ length: MAX_LEVEL + 1 }, (_, i) => (i === 1 ? ACTIVE_CFG.startFreeBees : 0)),
    kovan: 0,                        // kovan seviyesi (üretim x2^n)
    depo: 0,                         // depo seviyesi (kapasite x4^n)
    lastCollect: now,                // son üretim işleme zamanı
    streak: 0,                       // günlük giriş serisi
    lastDaily: 0,
    refs: 0,                         // davet ettiği arkadaş sayısı
    inviter: null,                   // onu davet eden kişinin id'si
    ach: [],                         // kazanılan başarı id'leri
    vzvzAt: 0,                       // son VızVız zamanı (bekleme için)
    vzvzCount: 0,                    // toplam VızVız oyunu
    banned: false,                   // admin tarafından men edildi mi
    // 🌟 Kozmetik & yıldız tozu
    cosmetics: [],
    stardust: 0,
    // ⚔️ PvP
    xp: 0,                           // savaş XP'si
    raidWins: 0,                     // kazandığı saldırılar
    raidLosses: 0,                   // kaybettiği saldırılar
    defended: 0,                     // püskürttüğü saldırılar
    defenseBal: 0,                   // kümülatif savunma geliri (arı ölümü eşiği)
    grudgeDef: 0,                    // kaç kez saldırıya uğradı
    created: now,
    lastSeen: now,
  };
}

// ── Üretim hesapları ──
function beeProd(level) {
  return ACTIVE_CFG.p1 * Math.pow(ACTIVE_CFG.pMult, level - 1);
}
function beeCost(s) {
  return Math.floor(ACTIVE_CFG.beeBaseCost * Math.pow(ACTIVE_CFG.beeCostGrowth, s.beesOwned));
}
// 🌙 Gece etkinliği: 22:00-06:00 arası üretim x2 (Türkiye saati)
function isNight(now = Date.now()) {
  // 🇹🇷 Türkiye saati: UTC+3 (2016'dan beri sabit, yaz/kış farkı yok)
  const h = (new Date(now).getUTCHours() + 3) % 24;
  return h >= 22 || h < 6;
}
function prodMultiplier(now = Date.now()) {
  return isNight(now) ? 1.5 : 1; // gece bonusu kısıldı (2x -> 1.5x)
}
function totalProd(s, now = Date.now()) {
  let t = 0;
  for (let l = 1; l <= MAX_LEVEL; l++) t += s.bees[l] * beeProd(l);
  return t * Math.pow(2, s.kovan) * effectiveMult(s, now);
}
// ⚡ Üretim çarpanı: gece x2 + çark boostu +1 (çakışırsa x3)
function effectiveMult(s, now = Date.now()) {
  let m = prodMultiplier(now); // gece 1.5
  if ((s.boostUntil || 0) > now) m += 0.5; // çark boostu +0.5
  if ((s.streakBoostUntil || 0) > now) m += 1; // toplama streak +1 (altın kovan x3)
  if ((s.warBoostUntil || 0) > now) m += 1; // savaşçı modu +1
  if (rainbowActive(s, now)) m += 1; // 🌈 gökkuşağı +1 (geceyle x3!)
  return m;
}
function capacity(s) {
  return ACTIVE_CFG.capBase * Math.pow(ACTIVE_CFG.capUpgMult, s.depo);
}
function depoCost(s) {
  return Math.floor(ACTIVE_CFG.capUpgBase * Math.pow(ACTIVE_CFG.capUpgCostMult, s.depo));
}
function kovanCost(s) {
  return Math.floor(ACTIVE_CFG.kovanBase * Math.pow(ACTIVE_CFG.kovanCostMult, s.kovan));
}

// ── Üretimi işle (kapasite doluysa taşan bal kaybolur → düzenli topla!) ──
// 🎯 DOP-2: Toplama Streak — 60 sn içinde art arda Topla
// 3 → üretim x1.2 (30sn) · 5 → x1.5 (60sn) · 10 → ALTIN KOVAN x3 (30sn)
function collectStreakMult(streak) {
  if (streak >= 10) return 3;
  if (streak >= 5) return 1.5;
  if (streak >= 3) return 1.2;
  return 1;
}
function collect(s, now = Date.now()) {
  const elapsed = Math.max(0, now - s.lastCollect);
  const cap = capacity(s);
  let gain = (totalProd(s, now) * elapsed) / 1000;
  // 🛑 CAP BUG FIX: bal zaten cap'e yakınsa gain, kalan boşluğa kesilir
  const room = Math.max(0, cap - (s.bal || 0));
  if (gain > room) gain = room;
  if (gain > 0) {
    s.bal += gain;
    s.totalEarned += gain;
  }
  // Streak: son 60 sn içinde tekrar toplandıysa devam
  if (now - (s.lastCollectAt || 0) < 60000) {
    s.collectStreak = (s.collectStreak || 0) + 1;
  } else {
    s.collectStreak = 1;
  }
  s.lastCollectAt = now;
  const cm = collectStreakMult(s.collectStreak || 0);
  if (s.collectStreak === 10) s.streakBoostUntil = now + 90000; // ALTIN KOVAN 90sn (en güçlü = en uzun)
  else if (s.collectStreak === 5) s.streakBoostUntil = now + 60000;
  else if (s.collectStreak === 3) s.streakBoostUntil = now + 45000;
  s.lastCollect = now;
  s.lastSeen = now;
  return { gain, streak: s.collectStreak || 0, mult: cm };
}

// ── Arı satın al + otomatik birleştirme (2 aynı seviye → 1 üst) ──
function buyBee(s, count = 1) {
  const cost = beeCost(s) * count;
  if (s.bal < cost) return { ok: false, why: 'yetersiz_bal' };
  s.bal -= cost;
  s.beesOwned += count;
  s.bees[1] += count;
  const merges = [];
  for (let l = 1; l < MAX_LEVEL; l++) {
    while (s.bees[l] >= 2) {
      s.bees[l] -= 2;
      s.bees[l + 1] += 1;
      merges.push(l + 1);
    }
  }
  return { ok: true, cost, merges };
}

// ── Yükseltmeler ──
function upgrade(s, which) {
  const cost = which === 'kovan' ? kovanCost(s) : depoCost(s);
  if (s.bal < cost) return { ok: false, why: 'yetersiz_bal' };
  s.bal -= cost;
  if (which === 'kovan') s.kovan++;
  else s.depo++;
  return { ok: true, cost };
}

// ── Günlük ödül (seri sistemi) ──
function claimDaily(s, now = Date.now()) {
  if (!ACTIVE_CFG.dailyEnabled) return null;
  const today = Math.floor(now / 86400000);
  const lastDay = Math.floor(s.lastDaily / 86400000);
  if (lastDay === today) return null;
  s.streak = lastDay === today - 1 ? s.streak + 1 : 1;
  if (s.streak > 7) s.streak = 1;
  s.lastDaily = now;
  const reward = DAILY_REWARDS[s.streak - 1];
  s.bal += reward;
  s.totalEarned += reward;
  return { streak: s.streak, reward };
}
function dailyInfo(s, now = Date.now()) {
  if (!ACTIVE_CFG.dailyEnabled) return { available: false, streak: 0, nextReward: 0 };
  const today = Math.floor(now / 86400000);
  const lastDay = Math.floor(s.lastDaily / 86400000);
  const available = lastDay !== today;
  const streak = lastDay === today - 1 ? s.streak + 1 : 1;
  const clamped = streak > 7 ? 1 : streak;
  return { available, streak: clamped, nextReward: DAILY_REWARDS[clamped - 1] };
}

// ── VızVız mini oyunu (10 sn dokunma yarışı) ──
// 🎯 DOP-1: VızVız COMBO — 5+ dokunuş x2, 10+ x3, 20+ BAL FRENZİ x5
function vzvzComboMult(taps) {
  if (taps >= 20) return 5;
  if (taps >= 10) return 3;
  if (taps >= 5) return 2;
  return 1;
}
function vzvzPlay(s, taps, durMs, now = Date.now()) {
  if (!ACTIVE_CFG.vzvzEnabled) return { ok: false, why: 'vzvz_kapali' };
  if (now - s.vzvzAt < ACTIVE_CFG.vzvzCooldownMs) return { ok: false, why: 'bekleme' };
  if (!Number.isInteger(taps) || taps < 0 || taps > ACTIVE_CFG.vzvzMaxTaps) return { ok: false, why: 'hile' };
  if (durMs > ACTIVE_CFG.vzvzMaxMs) return { ok: false, why: 'hile' };
  s.vzvzAt = now;
  s.vzvzCount++;
  const mult = vzvzComboMult(taps);
  const reward = Math.round(taps * ACTIVE_CFG.vzvzTapReward * mult);
  s.bal += reward;
  s.totalEarned += reward;
  s.weeklyEarned = (s.weeklyEarned || 0) + reward;
  s.todayEarned = (s.todayEarned || 0) + reward;
  if (taps >= 20) s.frenzyCount = (s.frenzyCount || 0) + 1; // rozet için
  return { ok: true, reward, taps, mult, frenzy: mult >= 5 };
}

/* ═══════════════════ 🎰 EĞLENCE ODASI ═══════════════════ */

// 🎡 Çarkıfelek dilimleri
const WHEEL_SLICES = [
  { id: 'x2', label: 'Üretim x1.5', emoji: '⚡', kind: 'boost', value: 150 },  // 5 dk x1.5
  { id: 'z0', label: '0', emoji: '😬', kind: 'zero', value: 0 },
  { id: 's15', label: '+15', emoji: '🍯', kind: 'bal', value: 15 },
  { id: 's60', label: '+60', emoji: '🍯', kind: 'bal', value: 60 },
  { id: 's30', label: '+30', emoji: '🍯', kind: 'bal', value: 30 },
  { id: 's250', label: '+250', emoji: '💛', kind: 'bal', value: 250 },
  { id: 's100', label: '+100', emoji: '🍯', kind: 'bal', value: 100 },
  { id: 's5', label: '+5', emoji: '🍯', kind: 'bal', value: 5 },
];

// Günde 1 bedava çevirme
function spinWheel(s, now = Date.now()) {
  const today = Math.floor(now / 86400000);
  if (s.lastSpin === today) return { ok: false, why: 'bugun_cirildi' };
  s.lastSpin = today;
  const slice = WHEEL_SLICES[Math.floor(Math.random() * WHEEL_SLICES.length)];
  let reward = 0;
  if (slice.kind === 'bal') {
    reward = slice.value;
    s.bal += reward;
    s.totalEarned += reward;
    s.weeklyEarned = (s.weeklyEarned || 0) + reward;
    s.todayEarned = (s.todayEarned || 0) + reward;
  } else if (slice.kind === 'boost') {
    s.boostUntil = now + 5 * 60 * 1000; // 5 dk üretim x2
  }
  return { ok: true, slice, reward };
}


/* ═══════════════════ 🎁 GÜNLÜK SANDIK (kumar yerine — çocuk dostu) ═══════════════════ */
const CHEST_REWARDS = [10, 25, 50, 100, 250, 500];
const CHEST_JACKPOT = 1000;
const CHEST_JACKPOT_CHANCE = 0.05;
const CHEST_EXTRA_COST = 100; // 2. kart

// Günde 1 bedava + 100 bal ile 2. kart (3 karttan 1'ini seç)
function openChest(s, cardIndex, now = Date.now()) {
  const day = Math.floor(now / 86400000);
  const todayUsed = s.chestDay === day ? (s.chestUses || 0) : 0;
  const allowed = todayUsed < 2; // günde max 2 kart (1 bedava + 1 ücretli)
  if (!allowed) return { ok: false, why: 'hak_yok' };
  if (todayUsed >= 1) {
    // 2. kart ücretli
    if ((s.bal || 0) < CHEST_EXTRA_COST) return { ok: false, why: 'yetersiz_bal' };
    s.bal -= CHEST_EXTRA_COST;
  }
  // Ödül: %5 jackpot, değilse rastgele dilim
  let reward;
  if (Math.random() < CHEST_JACKPOT_CHANCE) reward = CHEST_JACKPOT;
  else reward = CHEST_REWARDS[Math.floor(Math.random() * CHEST_REWARDS.length)];
  // kart seçimi görsel: ödül kartIndex'e verilir (sunucu doğru kartı söyler)
  s.bal += reward;
  s.totalEarned += reward;
  s.weeklyEarned = (s.weeklyEarned || 0) + reward;
  s.todayEarned = (s.todayEarned || 0) + reward;
  s.chestDay = day;
  s.chestUses = todayUsed + 1;
  s.chestCount = (s.chestCount || 0) + 1;
  if (reward >= CHEST_JACKPOT) s.jackpotCount = (s.jackpotCount || 0) + 1;
  return { ok: true, reward, card: cardIndex, jackpot: reward >= CHEST_JACKPOT, uses: s.chestUses };
}
function chestInfo(s, now = Date.now()) {
  const day = Math.floor(now / 86400000);
  const used = s.chestDay === day ? (s.chestUses || 0) : 0;
  return { freeLeft: used < 1 ? 1 : 0, paidLeft: used < 2 ? 1 : 0, used };
}

/* ═══════════════════ 🐝 ARILAR ═══════════════════ */

// Seviyeye göre arı görünümü (kozmetik)
const BEE_EMOJIS = ['🐝', '🦋', '🦅', '🐉', '🦁', '🐯', '🦂', '🦄', '👑', '🔥'];
function beeEmoji(level) {
  return BEE_EMOJIS[Math.min(level - 1, BEE_EMOJIS.length - 1)];
}

/* ── Haftalık/bugünlük sayaçlar (her kazançta işlenir) ── */
function addEarned(s, amount, now = Date.now()) {
  // 🐛 FIX: önce hafta/gün anahtarı kontrolü (çift sayım yok)
  const wk = Math.floor(now / (7 * 86400000));
  if (s.weekKey !== wk) { s.weekKey = wk; s.weeklyEarned = 0; }
  const day = Math.floor(now / 86400000);
  if (s.dayKey !== day) { s.dayKey = day; s.todayEarned = 0; }
  s.weeklyEarned = (s.weeklyEarned || 0) + amount;
  s.todayEarned = (s.todayEarned || 0) + amount;
}

// ── Başarılar (rozetler) ──
const ACHIEVEMENTS = [
  { id: 'bee1',     emoji: '🐝', name: 'İlk Arı',        desc: 'İlk arını al',                    cond: (s) => s.beesOwned >= 1,                  reward: 10 },
  { id: 'bees10',   emoji: '👑', name: 'Arı Ustası',     desc: '10 arı sahibi ol',                cond: (s) => s.beesOwned >= 10,                 reward: 100 },
  { id: 'bees50',   emoji: '🏰', name: 'Arı Kralı',      desc: '50 arı sahibi ol',                cond: (s) => s.beesOwned >= 50,                 reward: 500 },
  { id: 'bees100',  emoji: '🤴', name: 'Arı İmparatoru', desc: '100 arı sahibi ol',               cond: (s) => s.beesOwned >= 100,                reward: 1500 },
  { id: 'level8',   emoji: '🌌', name: 'Bal Kaşifi',     desc: 'Seviye 8 arı üret',               cond: (s) => s.bees[8] > 0,                     reward: 800 },
  { id: 'level10',  emoji: '🐉', name: 'Efsane Kovan',   desc: 'Seviye 10 arı üret',              cond: (s) => s.bees[10] > 0,                    reward: 5000 },
  { id: 'cap10k',   emoji: '🏺', name: 'Depo Delisi',    desc: 'Depo 10.000 kapasiteye ulaş',     cond: (s) => capacity(s) >= 10000,               reward: 250 },
  { id: 'kovan5',   emoji: '🏭', name: 'Usta Kovan',     desc: 'Kovan seviye 5',                  cond: (s) => s.kovan >= 5,                      reward: 1000 },
  { id: 'mil',      emoji: '💎', name: 'Bal Milyoneri',  desc: 'Toplam 1.000.000 bal',            cond: (s) => s.totalEarned >= 1e6,               reward: 5000 },
  { id: 'streak7',  emoji: '🔥', name: '7 Gün',          desc: '7 günlük giriş serisi',           cond: (s) => s.streak >= 7,                     reward: 300 },
  { id: 'ref3',     emoji: '🎁', name: 'Davetçi',        desc: '3 arkadaş davet et',              cond: (s) => s.refs >= 3,                       reward: 300 },
  { id: 'vzvz10',   emoji: '⚡', name: 'VızVız Ustası',  desc: '10 kez VızVız oyna',              cond: (s) => s.vzvzCount >= 10,                 reward: 200 },
  { id: 'fast',     emoji: '🚀', name: 'Hız Canavarı',   desc: 'İlk gün 1.000 bal topla',         cond: (s, now) => s.totalEarned >= 1000 && now - s.created < 86400000, reward: 500 },
];

// Yeni kazanılan başarıları verir + ödüllerini verir
function checkAchievements(s, now = Date.now()) {
  if (!Array.isArray(s.ach)) s.ach = []; // eski state'lerde ach yok olabilir
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (!s.ach.includes(a.id) && a.cond(s, now)) {
      s.ach.push(a.id);
      s.bal += a.reward;
      s.totalEarned += a.reward;
      fresh.push({ id: a.id, emoji: a.emoji, name: a.name, reward: a.reward });
    }
  }
  return fresh;
}

// Admin: rozet manuel ver/çıkar
function giveAchievement(s, achId) {
  const a = ACHIEVEMENTS.find((x) => x.id === achId);
  if (!a) return { ok: false, why: 'rozet_yok' };
  if (s.ach.includes(achId)) return { ok: false, why: 'zaten_var' };
  s.ach.push(achId);
  s.bal += a.reward;
  s.totalEarned += a.reward;
  return { ok: true, reward: a.reward };
}

/* ═══════════════════ 💥 BAL BOMBASI (Emoji Fırlatma) ═══════════════════ */
const THROW_EMOJI_COST = 25;
const THROW_EMOJI_COOLDOWN_MS = 30 * 1000;
const THROW_EMOJIS = ['🍅', '🔥', '💣', '🎉', '🐝', '🍯', '🥊', '💧', '👑', '🎈'];

function throwEmoji(s, targetId, emoji, now = Date.now()) {
  if (!THROW_EMOJIS.includes(emoji)) return { ok: false, why: 'emoji_gecersiz' };
  if (now - (s.lastThrow || 0) < THROW_EMOJI_COOLDOWN_MS) return { ok: false, why: 'bekleme' };
  if ((s.bal || 0) < THROW_EMOJI_COST) return { ok: false, why: 'yetersiz_bal' };
  s.bal -= THROW_EMOJI_COST;
  s.lastThrow = now;
  s.thrownCount = (s.thrownCount || 0) + 1;
  return { ok: true, emoji, targetId };
}

// ── Oyuncu seviyesi (kozmetik) ──
const LEVEL_THRESHOLDS = [0, 200, 1000, 5000, 20000, 100000, 500000, 2.5e6, 1e7, 5e7, 2.5e8];
const LEVEL_TITLES = ['Yavru Arı', 'Bal Toplayıcı', 'Kovan Çırağı', 'Arıcı', 'Usta Arıcı',
  'Bal Baronu', 'Kovan Lordu', 'Bal Kralı', 'Arı İmparatoru', 'Bal Efsanesi', 'Kozmik Kovan'];
function playerLevel(s) {
  let lvl = 1;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) if (s.totalEarned >= LEVEL_THRESHOLDS[i]) lvl = i + 1;
  return { level: lvl, title: LEVEL_TITLES[Math.min(lvl, LEVEL_TITLES.length) - 1] };
}

/* ═══════════════════ ⚔️ BAL BASKINI (PvP) ═══════════════════ */

// ── Savaşçı (XP) seviyesi: seviye N için 50×N XP ──
const WAR_XP_PER_LEVEL = 50;
function warLevel(xp) {
  const level = Math.max(1, Math.floor(xp / WAR_XP_PER_LEVEL) + 1);
  return { level, xp, into: xp % WAR_XP_PER_LEVEL, need: WAR_XP_PER_LEVEL };
}

// ── Saldırı gücü ──
function raidPower(s) {
  const wl = warLevel(s.xp || 0).level;
  return (totalProd(s) * 10) + (wl * 50) + (s.beesOwned * 5) + (s.kovan * 200);
}

// Arıları en düşük seviyeden sil (n adet); 0'ın altına inmez, hiç arı kalmazsa 1 ücretsiz verilir
function killBees(s, n) {
  if (!Number.isInteger(n) || n <= 0) return 0;
  // 🐛 FIX: oranlı silme — her seviyeden orantılı, kimse tamamen sıfırlanmaz
  const total = s.beesOwned || 0;
  if (total <= 0) return 0;
  const ratio = n / total; // silinecek oran
  let killed = 0;
  for (let l = 1; l <= MAX_LEVEL; l++) {
    if (s.bees[l] <= 0) continue;
    const kill = Math.max(1, Math.floor(s.bees[l] * ratio));
    const real = Math.min(s.bees[l], kill);
    s.bees[l] -= real;
    s.beesOwned -= real;
    killed += real;
  }
  if (s.beesOwned < 1) { s.bees[1] = 1; s.beesOwned = 1; }
  return killed;
}

// Savunma geliri eşiği: aşılırsa bir sonraki başarılı saldırıda arı ölümü tetiklenir
const DEFENSE_BAL_THRESHOLD = 800;

// ── Savaş çözümü ──
// A: saldırgan, T: hedef, defendActive: hedef 'Püskürt'e bastı mı (çevrimiçi savunma)
// Döner: { winner: 'A'|'T'|'draw', xpA, xpT, stolen, beesKilled, defenseGain, ratio, koalisyon }
function resolveRaid(A, T, defendActive, now = Date.now()) {
  const aPow = raidPower(A) * (0.9 + Math.random() * 0.2);
  const tPow = raidPower(T) * (defendActive ? 1.25 : 0.9);
  const ratio = aPow / tPow;

  let winner = 'draw', xpA = 0, xpT = 0, stolen = 0, beesKilled = 0, defenseGain = 0;
  const wlA = warLevel(A.xp || 0).level;
  const wlT = warLevel(T.xp || 0).level;

  if (ratio >= 1.05) {
    // 💥 SALDIRGAN KAZANDI
    winner = 'A';
    xpA = 10 + wlT * 2;
    A.xp = (A.xp || 0) + xpA;
    A.raidWins = (A.raidWins || 0) + 1;
    T.raidLosses = (T.raidLosses || 0) + 1;

    // Bal çalma: hedefin balından depo kapasitesinin %8'i (en fazla)
    const capT = capacity(T);
    stolen = Math.min(capT * 0.03, (T.bal || 0) * 0.06, (T.bal || 0)); // cimri: %3 depo / %6 bal
    T.bal = Math.max(0, (T.bal || 0) - stolen);
    // Çalınan bal saldırganın deposuna sığarsa
    A.bal = (A.bal || 0) + Math.min(stolen, capacity(A));

    // SAVUNMA GELİRİ: kurban çalınanın %50'sini "sigorta" olarak geri alır
    defenseGain = stolen * 0.5;
    T.bal = (T.bal || 0) + defenseGain;
    T.defenseBal = (T.defenseBal || 0) + defenseGain;

    // Arı hasarı: güç oranı büyüdükçe daha çok arı ölür
    const dmg = Math.min(0.6, Math.max(0.02, 1 - 1 / ratio));
    beesKilled = killBees(T, Math.ceil((T.beesOwned || 1) * dmg * 0.2));

    // 🩸 BAL KAZANCI EŞİĞİ: savunma geliri birikimi eşiği aşarsa +1 arı ölür
    if ((T.defenseBal || 0) >= DEFENSE_BAL_THRESHOLD) {
      beesKilled += killBees(T, 1);
      T.defenseBal = 0; // eşik sıfırlanır (tekrar 2000 biriktirmek gerekir)
    }

    T.grudgeDef = (T.grudgeDef || 0) + 1;
    T.lastRaidTs = now;
  } else if (ratio <= 0.95) {
    // 🛡️ SAVUNAN PÜSKÜRTTÜ
    winner = 'T';
    xpT = 8 + wlA * 2;
    T.xp = (T.xp || 0) + xpT;
    T.defended = (T.defended || 0) + 1;
    T.defenseBal = (T.defenseBal || 0) + 100 + wlA * 20; // savunma geliri
    T.grudgeDef = (T.grudgeDef || 0) + 1;
    T.lastRaidTs = now;
    // Saldırgan XP cezası
    A.xp = Math.max(0, (A.xp || 0) - 15);
    A.raidLosses = (A.raidLosses || 0) + 1;
  } else {
    // 🤝 Berabere: iki taraf da 2 XP alır, bal yok
    winner = 'draw';
    A.xp = (A.xp || 0) + 2;
    T.xp = (T.xp || 0) + 2;
  }

  return { winner, xpA, xpT, stolen, beesKilled, defenseGain, ratio, wlA, wlT };
}

// Karşılıklı saldırı cezası: son 10 dk içinde T→A saldırısı varsa ikisine de −10 XP
function mutualRaidPenalty(A, T, now = Date.now()) {
  const wA = warLevel(A.xp || 0).level;
  const wT = warLevel(T.xp || 0).level;
  const penalty = 10;
  A.xp = Math.max(0, (A.xp || 0) - penalty);
  T.xp = Math.max(0, (T.xp || 0) - penalty);
  return { penalty, wA, wT };
}

// Koalisyon: aynı hedefe son 10 dk içinde 2+ farklı saldırgan varsa +5 XP
function coalitionBonus(attacker, count) {
  if (count >= 2) {
    attacker.xp = (attacker.xp || 0) + 5;
    return 5;
  }
  return 0;
}

/* ═══════════════════ 📋 GÜNLÜK GÖREVLER ═══════════════════ */
const DAILY_QUESTS = [
  { id: 'buy',   emoji: '🐝', name: 'Arı Avcısı',   desc: '3 arı satın al',      target: 3, reward: 40 },
  { id: 'collect', emoji: '🍯', name: 'Bal Toplayıcı', desc: '5 kez bal topla',   target: 5, reward: 40 },
  { id: 'vzvz',  emoji: '⚡', name: 'VızVız Ustası', desc: '1 kez VızVız oyna',   target: 1, reward: 50 },
  { id: 'raid',  emoji: '⚔️', name: 'Savaşçı',      desc: '1 savaşa katıl',      target: 1, reward: 60 },
  { id: 'spin',  emoji: '🎡', name: 'Çarkçı',        desc: '1 çark çevir',        target: 1, reward: 30 },
];
const QUEST_ALL_BONUS = 100; // hepsini bitir → bonus

function questState(s, now = Date.now()) {
  const day = Math.floor(now / 86400000);
  // Eski state'lerde alanlar yok olabilir — her zaman güvencele
  if (!s.questProg || typeof s.questProg !== 'object') s.questProg = { buy: 0, collect: 0, vzvz: 0, raid: 0, spin: 0 };
  if (!Array.isArray(s.questClaimed)) s.questClaimed = [];
  if (!s.questDay || s.questDay !== day) {
    s.questDay = day;
    s.questProg = { buy: 0, collect: 0, vzvz: 0, raid: 0, spin: 0 };
    s.questClaimed = [];
  }
  return s;
}
function questProgress(s, id, amount = 1, now = Date.now()) {
  questState(s, now);
  if (!(id in s.questProg)) return { ok: false };
  s.questProg[id] = Math.min(s.questProg[id] + amount, 99);
  return { ok: true, prog: s.questProg, claimed: s.questClaimed || [] };
}
function questClaim(s, id, now = Date.now()) {
  questState(s, now);
  const q = DAILY_QUESTS.find((x) => x.id === id);
  if (!q) return { ok: false, why: 'gorev_yok' };
  if ((s.questClaimed || []).includes(id)) return { ok: false, why: 'zaten_aldi' };
  if ((s.questProg[id] || 0) < q.target) return { ok: false, why: 'tamamlanmadi' };
  s.questClaimed.push(id);
  s.bal += q.reward;
  s.totalEarned += q.reward;
  // Hepsini bitirince bonus
  const allDone = DAILY_QUESTS.every((x) => s.questClaimed.includes(x.id));
  let bonus = 0;
  if (allDone) { s.bal += QUEST_ALL_BONUS; s.totalEarned += QUEST_ALL_BONUS; bonus = QUEST_ALL_BONUS; }
  return { ok: true, reward: q.reward, bonus, id };
}
function questInfo(s, now = Date.now()) {
  questState(s, now);
  return DAILY_QUESTS.map((q) => ({
    ...q,
    prog: s.questProg[q.id] || 0,
    done: (s.questProg[q.id] || 0) >= q.target,
    claimed: (s.questClaimed || []).includes(q.id),
  }));
}

/* ═══════════════════ 🎪 MİNİ OYUNLAR ═══════════════════ */

// 🎈 BALON PATLATMA — skor tabanlı ödül
function balloonReward(score) {
  if (score >= 50) return 200;
  if (score >= 40) return 100;
  if (score >= 30) return 60;
  if (score >= 20) return 35;
  if (score >= 10) return 15;
  return 5;
}
function balloonComboMult(combo) {
  if (combo >= 20) return 5;  // BAL FRENZİ
  if (combo >= 10) return 3;
  if (combo >= 5) return 2;
  return 1;
}
function playBalloon(s, score, now = Date.now()) {
  if (!Number.isInteger(score) || score < 0 || score > 200) return { ok: false, why: 'hile' };
  if (now - (s.balloonAt || 0) < 120000) return { ok: false, why: 'bekleme' }; // 2 dk
  s.balloonAt = now;
  s.balloonCount = (s.balloonCount || 0) + 1;
  const reward = balloonReward(score);
  s.bal += reward;
  s.totalEarned += reward;
  s.weeklyEarned = (s.weeklyEarned || 0) + reward;
  s.todayEarned = (s.todayEarned || 0) + reward;
  if (score >= 50) s.balloonKingCount = (s.balloonKingCount || 0) + 1; // rozet
  return { ok: true, reward, score, best: score };
}

// ⏰ ZAMANLAYICI — hedefe yakınlığa göre ödül
function timerReward(diff) {
  if (diff <= 0.05) return 100;  // MÜKEMMEL
  if (diff <= 0.10) return 60;   // Harika
  if (diff <= 0.20) return 30;   // İyi
  return 10;                      // Bir daha dene
}
function playTimer(s, stoppedAt, target, now = Date.now()) {
  if (!Number.isFinite(stoppedAt) || stoppedAt < 0 || stoppedAt > 1.5) return { ok: false, why: 'hile' };
  if (!Number.isFinite(target) || target < 0.3 || target > 1.2) return { ok: false, why: 'hile' };
  // günde 3 deneme
  const day = Math.floor(now / 86400000);
  if (s.timerDay === day && (s.timerPlays || 0) >= 3) return { ok: false, why: 'hak_yok' };
  if (s.timerDay !== day) { s.timerDay = day; s.timerPlays = 0; }
  s.timerPlays = (s.timerPlays || 0) + 1;
  const diff = Math.abs(stoppedAt - target);
  const reward = timerReward(diff);
  s.bal += reward;
  s.totalEarned += reward;
  s.weeklyEarned = (s.weeklyEarned || 0) + reward;
  s.todayEarned = (s.todayEarned || 0) + reward;
  const perfect = diff <= 0.05;
  if (perfect) s.timerPerfect = (s.timerPerfect || 0) + 1;
  return { ok: true, reward, diff, perfect };
}

/* ═══════════════════ 🌈 RASTGELE OLAYLAR ═══════════════════ */
const RAINBOW_CHANCE = 0.05; // %5/gün
const RAINBOW_DURATION_MS = 10 * 60 * 1000; // 10 dk

// Gökkuşağı: oyuna girişte %5 şans, üretim x2 10 dk
function rollRainbow(s, now = Date.now()) {
  const day = Math.floor(now / 86400000);
  if (s.rainbowDay === day) return null; // günde 1 kez
  if (Math.random() >= RAINBOW_CHANCE) return null;
  s.rainbowDay = day;
  s.rainbowUntil = now + RAINBOW_DURATION_MS;
  return { until: s.rainbowUntil, durationMs: RAINBOW_DURATION_MS };
}
function rainbowActive(s, now = Date.now()) {
  return (s.rainbowUntil || 0) > now;
}

/* ═══════════════════ 🐝 LABİRENT MİNİ OYUNU ═══════════════════ */
const MAZE_LEVELS = [
  { lvl: 1, size: 5, flowers: 3, timeSec: 60, base: 20, flowerBonus: 5,  next: 2 },
  { lvl: 2, size: 6, flowers: 4, timeSec: 55, base: 40, flowerBonus: 8,  next: 3 },
  { lvl: 3, size: 7, flowers: 5, timeSec: 50, base: 70, flowerBonus: 12, next: null },
];
const MAZE_DAILY_PLAYS = 3;
function playMaze(s, level, flowers, won, now = Date.now()) {
  const cfg = MAZE_LEVELS[level - 1];
  if (!cfg) return { ok: false, why: 'seviye_yok' };
  if (!Number.isInteger(flowers) || flowers < 0 || flowers > cfg.flowers) return { ok: false, why: 'hile' };
  // Seviye kilitli mi? (ardışık açılır)
  const unlocked = s.mazeLevel || 1;
  if (level > unlocked) return { ok: false, why: 'kilitli' };
  // Günde 3 hak
  const day = Math.floor(now / 86400000);
  if (s.mazeDay === day && (s.mazePlays || 0) >= MAZE_DAILY_PLAYS) return { ok: false, why: 'hak_yok' };
  if (s.mazeDay !== day) { s.mazeDay = day; s.mazePlays = 0; }
  s.mazePlays = (s.mazePlays || 0) + 1;
  // Ödül: kazanırsan taban + çiçek bonusu; kaybedersen minik teselli
  let reward = 0;
  if (won) {
    reward = cfg.base + flowers * cfg.flowerBonus;
    if (cfg.next && unlocked < cfg.next) s.mazeLevel = cfg.next; // sonraki seviyeyi aç
    s.mazeWins = (s.mazeWins || 0) + 1;
  } else {
    reward = 5; // teselli
  }
  s.bal += reward;
  s.totalEarned += reward;
  s.weeklyEarned = (s.weeklyEarned || 0) + reward;
  s.todayEarned = (s.todayEarned || 0) + reward;
  return { ok: true, reward, won, level, unlockedNext: s.mazeLevel || 1 };
}

/* ═══════════════════ 🎪 SİRK OLAYI (%3/gün) ═══════════════════ */
const CIRCUS_CHANCE = 0.03;
const CIRCUS_DURATION_MS = 24 * 3600 * 1000; // 24 saat
function rollCircus(s, now = Date.now()) {
  const day = Math.floor(now / 86400000);
  if (s.circusDay === day) return null;
  if (Math.random() >= CIRCUS_CHANCE) return null;
  s.circusDay = day;
  s.circusUntil = now + CIRCUS_DURATION_MS;
  return { until: s.circusUntil };
}
function circusActive(s, now = Date.now()) {
  return (s.circusUntil || 0) > now;
}

/* ═══════════════════ 👽 UZAYLI + YILDIZ TOZU + MARKET ═══════════════════ */
const ALIEN_CHANCE = 0.01;
const ALIEN_GIFT_STARDUST = 50;
function rollAlien(s, now = Date.now()) {
  const day = Math.floor(now / 86400000);
  if (s.alienDay === day) return null;
  if (Math.random() >= ALIEN_CHANCE) return null;
  s.alienDay = day;
  s.stardust = (s.stardust || 0) + ALIEN_GIFT_STARDUST;
  return { stardust: s.stardust, gift: ALIEN_GIFT_STARDUST };
}
const MARKET_ITEMS = [
  { id: 'crown',   name: 'Altın Taç',  emoji: '👑', price: 300, desc: 'Profilde taç gösterir' },
  { id: 'glow',    name: 'Parlayan Arı', emoji: '✨', price: 500, desc: 'Arıların parıldar' },
  { id: 'rainbow', name: 'Gökkuşağı Kovan', emoji: '🌈', price: 800, desc: 'Kovan renk değiştirir' },
];
function buyCosmetic(s, id, now = Date.now()) {
  const item = MARKET_ITEMS.find((i) => i.id === id);
  if (!item) return { ok: false, why: 'urun_yok' };
  if ((s.stardust || 0) < item.price) return { ok: false, why: 'toz_yok' };
  if ((s.cosmetics || []).includes(id)) return { ok: false, why: 'zaten_var' };
  s.stardust -= item.price;
  if (!Array.isArray(s.cosmetics)) s.cosmetics = [];
  s.cosmetics.push(id);
  return { ok: true, item, stardust: s.stardust };
}

return {MAX_LEVEL, DEFAULT_CONFIG, setActiveCfg, getActiveCfg, DAILY_REWARDS, REF_INVITER, REF_FRIEND, VIZVIZ_MAX_MS, VIZVIZ_COOLDOWN_MS, newState, beeProd, beeCost, isNight, prodMultiplier, totalProd, effectiveMult, capacity, depoCost, kovanCost, collectStreakMult, collect, buyBee, upgrade, claimDaily, dailyInfo, vzvzComboMult, vzvzPlay, WHEEL_SLICES, spinWheel, CHEST_REWARDS, CHEST_JACKPOT, CHEST_JACKPOT_CHANCE, CHEST_EXTRA_COST, openChest, chestInfo, BEE_EMOJIS, beeEmoji, addEarned, ACHIEVEMENTS, checkAchievements, giveAchievement, THROW_EMOJI_COST, THROW_EMOJI_COOLDOWN_MS, THROW_EMOJIS, throwEmoji, playerLevel, WAR_XP_PER_LEVEL, warLevel, raidPower, killBees, DEFENSE_BAL_THRESHOLD, resolveRaid, mutualRaidPenalty, coalitionBonus, DAILY_QUESTS, QUEST_ALL_BONUS, questState, questProgress, questClaim, questInfo, balloonReward, balloonComboMult, playBalloon, timerReward, playTimer, RAINBOW_CHANCE, RAINBOW_DURATION_MS, rollRainbow, rainbowActive, MAZE_LEVELS, MAZE_DAILY_PLAYS, playMaze, CIRCUS_CHANCE, CIRCUS_DURATION_MS, rollCircus, circusActive, ALIEN_CHANCE, ALIEN_GIFT_STARDUST, rollAlien, MARKET_ITEMS, buyCosmetic};
})();
__lib['db'] = (() => {
// 🗄️ Bal Vakti — veritabanı katmanı (3 mod)

const { DEFAULT_CONFIG } = __lib['game']; // (yalnızca tip referansı — döngü yok)

// 🗄️ Veritabanı: FIREBASE_DB_URL (tek seçenek — Upstash desteği kaldırıldı)
const HAS_FIREBASE = !!process.env.FIREBASE_DB_URL;
const DB = (process.env.FIREBASE_DB_URL || '').replace(/\/+$/, '');
const P = 'balvakti';
const mem = new Map();

function safeParse(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

/* ══════════ Temel primitifler (3 backend → tek arayüz) ══════════ */
// key örn: "users/<id>" — backend'e göre path'e çevrilir

async function kvGet(key) {
  if (HAS_FIREBASE) {
    const r = await fetch(`${DB}/${P}/${key}.json`);
    if (!r.ok) throw new Error(`fb get ${key}: ${r.status}`);
    return r.json();
  }
  return safeParse(mem.get(`${P}/${key}`));
}
async function kvSet(key, val) {
  const s = JSON.stringify(val);
  if (HAS_FIREBASE) {
    const r = await fetch(`${DB}/${P}/${key}.json`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: s,
    });
    if (!r.ok) throw new Error(`fb put ${key}: ${r.status}`);
    return;
  }
  mem.set(`${P}/${key}`, s);
}
async function kvDel(key) {
  if (HAS_FIREBASE) {
    const r = await fetch(`${DB}/${P}/${key}.json`, { method: 'DELETE' });
    if (!r.ok) throw new Error(`fb del ${key}: ${r.status}`);
    return;
  }
  mem.delete(`${P}/${key}`);
}
// Bir prefix altındaki her şeyi { altAnahtar: değer } olarak döner
async function kvGetAll(prefix) {
  if (HAS_FIREBASE) {
    const r = await fetch(`${DB}/${P}/${prefix}.json`);
    if (!r.ok) throw new Error(`fb get ${prefix}: ${r.status}`);
    const data = await r.json();
    return data || {};
  }
  const out = {};
  for (const [k, v] of mem.entries()) {
    if (k.startsWith(`${P}/${prefix}/`)) {
      out[k.slice(`${P}/${prefix}/`.length)] = safeParse(v);
    }
  }
  return out;
}

function dbMode() {
  return HAS_FIREBASE ? 'firebase' : 'memory';
}

/* ── Oyuncular ── */
async function getUser(id) { return kvGet(`users/${id}`); }
async function saveUser(id, state) { return kvSet(`users/${id}`, state); }
async function allUsers(limit = 1000) {
  const obj = await kvGetAll('users');
  const out = [];
  for (const [id, st] of Object.entries(obj)) {
    if (!st) continue;
    out.push({ id, st });
    if (out.length >= limit) break;
  }
  return out;
}
async function scanUserKeys(limit = 1000) {
  const users = await allUsers(limit);
  return users.map((u) => `users/${u.id}`);
}

/* ── Referans kodları ── */
async function getRef(code) {
  const v = await kvGet(`refs/${code}`);
  return v == null ? null : String(v);
}
async function setRef(code, id) { return kvSet(`refs/${code}`, String(id)); }

/* ── Liderlik tablosu ── */
async function syncLb(id, name, score) {
  await Promise.all([kvSet(`names/${id}`, name || 'Anonim'), kvSet(`lb/${id}`, score)]);
}
async function topLb(n = 30) {
  const [lb, names] = await Promise.all([kvGetAll('lb'), kvGetAll('names')]);
  const arr = Object.entries(lb).map(([id, score]) => ({
    id, name: (names && names[id]) || 'Anonim', score: Number(score) || 0,
  }));
  return arr.sort((a, b) => b.score - a.score).slice(0, n);
}
async function myRank(id) {
  const top = await topLb(10000);
  const i = top.findIndex((x) => x.id === String(id));
  return i < 0 ? null : i + 1;
}

// 🏆 Haftalık / bugünkü sıralama (allUsers'tan hesaplanır — Firebase tek istek)
async function topWeekly(n = 10) {
  const users = await allUsers(1000);
  return users
    .map(({ id, st }) => ({ id, name: st.name || 'Anonim', score: st.weeklyEarned || 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}
async function topToday(n = 10) {
  const users = await allUsers(1000);
  return users
    .map(({ id, st }) => ({ id, name: st.name || 'Anonim', score: st.todayEarned || 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

/* ── Canlı konfigürasyon ── */
async function getConfig() {
  const base = { ...DEFAULT_CONFIG };
  const stored = await kvGet('cfg');
  return { ...base, ...(stored ? safeParse(stored) : {}) };
}
async function setConfig(partial) {
  const next = { ...(await getConfig()), ...partial };
  await kvSet('cfg', next);
  return next;
}

/* ── Admin oturumları ── */
async function createSession(token, id) { return kvSet(`adminsess/${token}`, String(id)); }
async function getSession(token) {
  const v = await kvGet(`adminsess/${token}`);
  return v == null ? null : String(v);
}
async function deleteSession(token) { return kvDel(`adminsess/${token}`); }

/* ── Toplu istatistik ── */
async function overview() {
  const users = await allUsers(2000);
  let totalBal = 0, totalEarned = 0, banned = 0, newToday = 0;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  for (const { st } of users) {
    totalBal += st.bal || 0;
    totalEarned += st.totalEarned || 0;
    if (st.banned) banned++;
    if ((st.created || 0) >= startOfDay.getTime()) newToday++;
  }
  return { players: users.length, totalBal, totalEarned, banned, newToday };
}

/* ═══════════════════ ⚔️ PvP ═══════════════════ */
async function getActiveRaid(targetId) { return kvGet(`activeRaids/${targetId}`); }
async function setActiveRaid(targetId, raid) { return kvSet(`activeRaids/${targetId}`, raid); }
async function clearActiveRaid(targetId) { return kvDel(`activeRaids/${targetId}`); }
async function allActiveRaids() { return kvGetAll('activeRaids'); }

async function addGrudge(targetId, entry) {
  const list = await getGrudges(targetId);
  list.unshift(entry);
  await kvSet(`grudges/${targetId}`, list.slice(0, 30));
}
async function getGrudges(targetId) {
  const v = await kvGet(`grudges/${targetId}`);
  return Array.isArray(v) ? v : [];
}

async function addRaidHist(userId, entry) {
  const list = await getRaidHist(userId);
  list.unshift(entry);
  await kvSet(`hist/${userId}`, list.slice(0, 20));
}
async function getRaidHist(userId) {
  const v = await kvGet(`hist/${userId}`);
  return Array.isArray(v) ? v : [];
}

async function recentRaiders(targetId, windowMs = 10 * 60 * 1000, now = Date.now()) {
  const gr = await getGrudges(targetId);
  const cutoff = now - windowMs;
  return [...new Set(gr.filter((g) => g.ts >= cutoff).map((g) => g.a))];
}

/* ── Telegram bildirimi ── */
async function tgNotify(userId, text) {
  const token = process.env.BOT_TOKEN;
  if (!token || !userId) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: String(userId), text, parse_mode: 'HTML' }),
    });
    const j = await r.json();
    return !!j.ok;
  } catch (e) {
    return false;
  }
}

/* ═══════════════════ 🤖 Botlar ═══════════════════ */
async function listBots() {
  const obj = await kvGetAll('bots');
  return Object.values(obj).filter(Boolean);
}
async function getBot(id) { return kvGet(`bots/${id}`); }
async function saveBot(bot) { return kvSet(`bots/${bot.id}`, bot); }
async function deleteBot(id) {
  await Promise.all([
    kvDel(`bots/${id}`), kvDel(`users/${id}`), kvDel(`names/${id}`), kvDel(`lb/${id}`),
  ]);
}
async function nextBotId() {
  const n = (Number(await kvGet('botseq')) || 0) + 1;
  await kvSet('botseq', n);
  return `bot_${n}`;
}

/* ── Beyin kilidi ── */
async function brainLock(ttlSec = 60) {
  const last = await kvGet('brainlock');
  if (last && Date.now() - Number(last) < ttlSec * 1000) return false;
  await kvSet('brainlock', Date.now());
  return true;
}

/* ── 🌍 Dünya olayları ── */
async function addEvent(entry) {
  const list = await getEvents();
  list.unshift({ ts: Date.now(), ...entry });
  await kvSet('events', list.slice(0, 30));
}
async function getEvents() {
  const v = await kvGet('events');
  return Array.isArray(v) ? v : [];
}

// 🎡 Dünya sayaçları (çark çevrilme, toplam kazanılan/kaybedilen)
async function bumpCounter(key, delta = 1) {
  const cur = Number(await kvGet(`cnt/${key}`)) || 0;
  await kvSet(`cnt/${key}`, cur + delta);
  return cur + delta;
}
async function getCounters() {
  const obj = await kvGetAll('cnt');
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = Number(v) || 0;
  return out;
}

// 💥 Gelen emoji bombaları (kurban oyuna girince animasyon için)
async function addIncomingEmoji(targetId, entry) {
  const list = await getIncomingEmojis(targetId);
  list.unshift(entry);
  await kvSet(`emojiIn/${targetId}`, list.slice(0, 20));
}
async function getIncomingEmojis(targetId) {
  const v = await kvGet(`emojiIn/${targetId}`);
  return Array.isArray(v) ? v : [];
}
async function clearIncomingEmojis(targetId) {
  await kvDel(`emojiIn/${targetId}`);
}

return {dbMode, getUser, saveUser, allUsers, scanUserKeys, getRef, setRef, syncLb, topLb, myRank, topWeekly, topToday, getConfig, setConfig, createSession, getSession, deleteSession, overview, getActiveRaid, setActiveRaid, clearActiveRaid, allActiveRaids, addGrudge, getGrudges, addRaidHist, getRaidHist, recentRaiders, tgNotify, listBots, getBot, saveBot, deleteBot, nextBotId, brainLock, addEvent, getEvents, bumpCounter, getCounters, addIncomingEmoji, getIncomingEmojis, clearIncomingEmojis};
})();
__lib['auth'] = (() => {
// 🔐 Bal Vakti — Telegram WebApp initData doğrulaması
// initData, Telegram tarafından imzalanır; hash'i bot token'ıyla doğrularız.
// Kaynak: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app


function parseInitData(initData) {
  if (!initData || typeof initData !== 'string') return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  // auth_date 24 saatten eskiyse reddet (Telegram önerisi)
  const authDate = parseInt(params.get('auth_date') || '0', 10);
  const now = Math.floor(Date.now() / 1000);
  if (!authDate || now - authDate > 86400 || authDate > now + 300) return null;

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN || '').digest();
  const computed = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computed !== hash) return null;

  let user = {};
  try {
    user = JSON.parse(params.get('user') || '{}');
  } catch {
    return null;
  }
  return { user, startParam: params.get('start_param') };
}

return {parseInitData};
})();
__lib['raidcore'] = (() => {
// ⚔️ Raid çözüm çekirdeği — api/raid.js, api/me.js, lib/brain.js ortak kullanır
// (API'ler arası döngüyü önlemek için ayrı modül)
const { getUser, saveUser, clearActiveRaid, addGrudge, getGrudges, addRaidHist, recentRaiders, tgNotify, syncLb, allActiveRaids, addEvent, bumpCounter } = __lib['db'];
const { collect, resolveRaid, mutualRaidPenalty, coalitionBonus, warLevel } = __lib['game'];

const RAID_PREP_MS = 15 * 1000; // 15 sn hazırlık ("çürüme" penceresi)

// ── Kullanıcıyı ilgilendiren SÜRESİ DOLMUŞ saldırıları çöz ──
// Hem savunma (bana saldırılmış) hem saldırı (ben saldırmışım) tarafında çalışır.
// Böylece saldırılar kurbanın girişine bağımlı kalmaz — kim girerse girsin çözülür,
// "zaten saldırıyorsun" kilidi bir daha yaşanmaz.
async function solveUserRaids(userId, now = Date.now()) {
  const raids = await allActiveRaids();
  const results = [];
  // 1) Savunma: bana saldırılmış ve süresi dolmuş
  const def = raids[userId];
  if (def && now >= def.endsAt) {
    results.push(await finalizeRaid(def, userId, false, now));
  }
  // 2) Saldırı: ben saldırmışım ve süresi dolmuş
  for (const k in raids) {
    const r = raids[k];
    if (r.a === userId && now >= r.endsAt) {
      results.push(await finalizeRaid(r, r.t, false, now));
    }
  }
  return results;
}

// ── Saldırıyı çöz ve sonuçları uygula ──
async function finalizeRaid(raid, defenderId, defendActive, now) {
  const A = await getUser(raid.a);
  const T = await getUser(raid.t);
  await clearActiveRaid(raid.t);
  await bumpCounter('war');
  if (!A || !T || A.banned) return { note: 'iptal' };

  collect(A); collect(T);
  const r = resolveRaid(A, T, defendActive, now);

  // Koalisyon kontrolü (aynı hedefe son 10 dk içinde başka saldırgan var mı?)
  const raiders = await recentRaiders(raid.t, 10 * 60 * 1000, now);
  const coal = coalitionBonus(A, raiders.length + 1); // kendisi dahil

  // Karşılıklı saldırı cezası (T→A saldırısı son 10 dk içinde var mı?)
  let mutual = null;
  const myRecent = await recentRaiders(raid.a, 10 * 60 * 1000, now);
  if (myRecent.includes(raid.t)) {
    mutual = mutualRaidPenalty(A, T, now);
  }

  // Kin kaydı (kurban perspektifi)
  await addGrudge(raid.t, {
    a: raid.a, name: raid.aName, ts: now, won: r.winner === 'A',
    stolen: r.stolen, xpGain: r.xpA, coal,
  });

  // Savaş geçmişleri
  const histA = {
    type: r.winner === 'A' ? 'win' : r.winner === 'T' ? 'loss' : 'draw',
    vs: raid.name, ts: now, xp: r.xpA, stolen: r.stolen, coal, mutual: !!mutual,
  };
  const histT = {
    type: r.winner === 'T' ? 'win' : r.winner === 'A' ? 'loss' : 'draw',
    vs: raid.aName, ts: now, xp: r.xpT, defenseGain: r.defenseGain,
    beesKilled: r.beesKilled, coal: coal > 0,
  };
  await addRaidHist(raid.a, histA);
  await addRaidHist(raid.t, histT);

  await saveUser(raid.a, A);
  await saveUser(raid.t, T);
  await syncLb(raid.a, A.name, A.totalEarned);
  await syncLb(raid.t, T.name, T.totalEarned);

  // 🌍 Dünya olay akışı (herkesin Savaş sekmesinde canlı görünür)
  if (r.winner === 'A') {
    await addEvent({ type: 'raid', emoji: '💥', txt: `${raid.aName} ${raid.name}'in kovanını yağmaladı! (+${fmtTg(r.stolen)} 🍯)` });
  } else if (r.winner === 'T') {
    await addEvent({ type: 'def', emoji: '🛡️', txt: `${raid.name}, ${raid.aName}'in saldırısını püskürttü!` });
  } else {
    await addEvent({ type: 'draw', emoji: '🤝', txt: `${raid.aName} ile ${raid.name} savaşta berabere kaldı!` });
  }

  // 📢 Sonuç bildirimleri
  const tW = warLevel(T.xp || 0).level;
  const aW = warLevel(A.xp || 0).level;

  if (r.winner === 'A') {
    await tgNotify(raid.t,
      `💥 <b>Kovanın yağmalandı!</b>\n\n` +
      `${escTg(raid.aName)} saldırını püskürtemedi.\n` +
      `🍯 <b>${fmtTg(r.stolen)} bal</b> çalındı · 🐝 ${r.beesKilled} arı hasar gördü\n` +
      `🛡️ Savunma geliri: <b>+${fmtTg(r.defenseGain)} bal</b>\n` +
      (r.beesKilled >= 2 ? `🩸 <i>Savunma gelirin eşiği aştı — arıların öldü!</i>\n` : '') +
      `😠 Kin: <b>+1</b> — İntikam vakti! ⚔️`);
    await tgNotify(raid.a,
      `⚔️ <b>SALDIRI BAŞARILI!</b>\n\n` +
      `${escTg(raid.name)}'in kovanını yağmaladın!\n` +
      `⭐ +${r.xpA} XP · 🍯 +${fmtTg(r.stolen)} bal çaldın\n` +
      (coal > 0 ? `🤝 Koalisyon bonusu: +${coal} XP\n` : '') +
      `Savaşçı seviyen: <b>${aW}</b>`);
  } else if (r.winner === 'T') {
    await tgNotify(raid.t,
      `🛡️ <b>PÜSKÜRTTÜN!</b>\n\n` +
      `${escTg(raid.aName)}'in saldırısını savdın!\n` +
      `⭐ +${r.xpT} XP · 🍯 Savunma geliri +${fmtTg(r.defenseGain)} bal\n` +
      `😤 Saldırgan ${fmtTg(15)} XP kaybetti (ceza)\n` +
      `İntikam listene eklendi! ⚔️`);
    await tgNotify(raid.a,
      `🩸 <b>PÜSKÜRTÜLDÜN!</b>\n\n` +
      `${escTg(raid.name)} saldırını savdı!\n` +
      `⭐ <b>−15 XP</b> (ceza) — savaşçı seviyen: <b>${aW}</b>\n` +
      `Bir dahaki sefere daha güçlü gel! 🐝`);
  } else {
    await tgNotify(raid.t, `🤝 ${escTg(raid.aName)} ile saldırın berabere bitti. İki taraf da +2 XP aldı.`);
    await tgNotify(raid.a, `🤝 ${escTg(raid.name)} ile savaşın berabere bitti. +2 XP aldın.`);
  }

  return {
    winner: r.winner, ratio: r.ratio, xpA: r.xpA, xpT: r.xpT,
    stolen: r.stolen, beesKilled: r.beesKilled, defenseGain: r.defenseGain,
    coal, mutual: mutual ? mutual.penalty : 0,
    aName: raid.aName, tName: raid.name,
    wA: aW, wT: tW,
  };
}

function escTg(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmtTg(n) {
  n = Math.floor(n || 0);
  return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
}

return {RAID_PREP_MS, solveUserRaids, finalizeRaid, escTg, fmtTg};
})();
__lib['brain'] = (() => {
// 🧠 Yapay Zekâ Arıcılar — bot beyni
// Her botun kişiliği ve zekâ parametreleri vardır; "uyanma" aralığında
// karar ağacını çalıştırır: savun → intikam → koalisyon → hedef seç → saldır.
// ⚡ PERFORMANS: tüm veriler (oyuncular + aktif saldırılar) TUR BAŞINA TEK
// seferde toplanır — Redis istek sayısı minimumda tutulur (Vercel timeout koruması).
const { getUser, saveUser, listBots, getActiveRaid, setActiveRaid, getGrudges, allUsers, tgNotify, brainLock, syncLb, nextBotId, saveBot, allActiveRaids, addEvent, } = __lib['db'];
const { newState, collect, raidPower, warLevel, checkAchievements, playerLevel, MAX_LEVEL } = __lib['game'];
const { finalizeRaid, RAID_PREP_MS, escTg } = __lib['raidcore'];

// ── Kişilik tanımları ──
const PERSONALITIES = {
  predator: { label: 'Akıllı Saldırgan', emoji: '🦅', ai: { aggr: 80, strat: 90, venge: 30, pack: 20 }, interval: [3, 6] },
  warrior:  { label: 'Savaşçı',         emoji: '⚔️', ai: { aggr: 95, strat: 40, venge: 40, pack: 30 }, interval: [2, 4] },
  grudge:   { label: 'Kindar',          emoji: '😤', ai: { aggr: 60, strat: 50, venge: 95, pack: 40 }, interval: [3, 6] },
  pack:     { label: 'Toplulukçu',      emoji: '🐝', ai: { aggr: 50, strat: 30, venge: 60, pack: 95 }, interval: [3, 7] },
  passive:  { label: 'Bal Toplayıcı',   emoji: '🍯', ai: { aggr: 10, strat: 70, venge: 50, pack: 20 }, interval: [6, 12] },
  chaos:    { label: 'Deli Arı',        emoji: '🌀', ai: { aggr: 90, strat: 5,  venge: 30, pack: 50 }, interval: [2, 5] },
};

// ── İsim & avatar havuzu (her bot benzersiz) ──
const NAME_POOL = [
  'Bal Hırsızı Kemal', 'Kovan Sarsan', 'Vızıltı Veli', 'Oğul Okan', 'Poyraz', 'Sinsi Sami',
  'Kaçak Arıcı', 'Deli Dumrul', 'Tombul Tony', 'Keskin Göz', 'Şahin Bey', 'Mırnav',
  'Çekirge', 'Bal Dükü', 'Kara Kovan', 'Sarı Sıcak', 'Arı Dede', 'Petek Recep',
  'Oğulcan', 'Kızgın Kamil', 'Zarif Ziya', 'Cırcır', 'Hınzır Hamza', 'Vahşi Vahit',
  'Gizli Gözcü', 'Sürü Beyi', 'Kraliçe Arı', 'İşçi Buse', 'Petek Pınar', 'Tatlı Belalı',
  'Kovan Deviren', 'Sessiz Savaşçı', 'Gece Bekçisi', 'Fırtına', 'Kıvılcım', 'Bal Küpü',
  'Acı Bal', 'Zehirli İğne', 'Altın Kanat', 'Çalışkan Karınca', 'Kral Oğul', 'Bozkurt',
];
const AVATAR_POOL = ['🐝', '🦅', '🐞', '🦗', '🐜', '🦂', '🐛', '🕷️', '🦟', '🐌', '🦎', '🐊', '🦀', '🦋', '🐢', '🐙'];

function randPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function randName(existing) {
  const taken = new Set(existing.map((b) => b.name));
  const pool = NAME_POOL.filter((n) => !taken.has(n));
  if (pool.length) return randPick(pool);
  return randPick(NAME_POOL) + ' ' + randInt(2, 99);
}

// ── Güç seviyeleri ──
const POWER_LEVELS = {
  zayif:   { label: 'Zayıf',   bees: [2, 5],    kovan: 0, depo: 0, bal: [50, 300] },
  orta:    { label: 'Orta',    bees: [6, 14],   kovan: 1, depo: 1, bal: [400, 1500] },
  guclu:   { label: 'Güçlü',   bees: [15, 35],  kovan: [2, 3], depo: 2, bal: [3000, 12000] },
  efsane:  { label: 'Efsane',  bees: [40, 100], kovan: [4, 6], depo: 3, bal: [20000, 80000] },
};

// Bot oyuncu durumu üret (güç seviyesine göre)
function makeBotState(levelKey = 'orta', now = Date.now()) {
  const lv = POWER_LEVELS[levelKey] || POWER_LEVELS.orta;
  const st = newState(now);
  const nBees = randInt(lv.bees[0], lv.bees[1]);
  // Arıları seviyelere dağıt (çoğu 1-2, biraz yüksek)
  st.bees = Array.from({ length: MAX_LEVEL + 1 }, () => 0);
  let rest = nBees;
  st.bees[1] = Math.ceil(rest * 0.5);
  rest -= st.bees[1];
  if (rest > 0) { st.bees[2] = Math.ceil(rest * 0.6); rest -= st.bees[2]; }
  if (rest > 0) { st.bees[3] = Math.ceil(rest * 0.7); rest -= st.bees[3]; }
  if (rest > 0) st.bees[4] = rest;
  st.beesOwned = nBees;
  st.kovan = Array.isArray(lv.kovan) ? randInt(lv.kovan[0], lv.kovan[1]) : lv.kovan;
  st.depo = lv.depo;
  st.bal = randInt(lv.bal[0], lv.bal[1]);
  st.totalEarned = st.bal; // liderlik tablosu
  st.xp = randInt(0, 300);
  st.created = now - randInt(1, 30) * 86400000; // "eski oyuncu" hissi
  return st;
}

// ── Yeni bot meta ──
async function createBot({ personality = 'warrior', powerLevel = 'orta', enabled = true } = {}) {
  const existing = await listBots();
  const id = await nextBotId();
  const name = randName(existing);
  const avatar = randPick(AVATAR_POOL);
  const per = PERSONALITIES[personality] || PERSONALITIES.warrior;
  const interval = randInt(per.interval[0] * 60, per.interval[1] * 60) * 1000;
  const bot = {
    id, name, avatar, personality,
    powerLevel,
    ai: { ...per.ai },
    enabled,
    intervalMs: interval,
    lastThink: Date.now() - randInt(0, interval), // ilk turda hepsi birden saldırmasın
    created: Date.now(),
  };
  await saveBot(bot);
  const st = makeBotState(powerLevel);
  st.name = name;
  st.avatar = avatar;
  await saveUser(id, st);
  await syncLb(id, name, st.totalEarned);
  return bot;
}

// ── Beyin turu (lazy: oyuncu girişlerinde çağrılır, 60 sn'de 1 kez) ──
// Tüm veriler TEK SEFERDE yüklenir → her bot için ayrı tarama YOK.
async function thinkBots({ force = false } = {}) {
  if (!force && !(await brainLock(60))) return { ran: false };
  const bots = await listBots();
  const now = Date.now();
  let ctx = null;
  const getCtx = async () => {
    if (!ctx) ctx = { users: await allUsers(400), activeRaids: await allActiveRaids() };
    return ctx;
  };
  // Güvenlik: tur başına en fazla 12 bot işlenir — botlar fazla olsa bile
  // tur hızlı biter, kalanlar sonraki turlara dağılır (Vercel timeout koruması)
  const MAX_BOTS_PER_TURN = 12;
  let acted = 0;
  let processed = 0;
  for (const b of bots) {
    if (processed >= MAX_BOTS_PER_TURN) break;
    if (!b.enabled) continue;
    if (!force && now - (b.lastThink || 0) < (b.intervalMs || 300000)) continue;
    b.lastThink = now;
    await saveBot(b);
    processed++;
    try {
      const did = await thinkBot(b, now, await getCtx());
      if (did) acted++;
    } catch (e) {
      console.error('🧠 bot hatası', b.id, e?.message || e);
    }
  }
  return { ran: true, bots: bots.length, acted, processed };
}

// ── Tek bot karar ağacı (ctx: ortak toplu veri) ──
async function thinkBot(b, now, ctx) {
  const me = b.id;
  const meEntry = ctx.users.find((u) => u.id === me);
  const st = meEntry ? meEntry.st : await getUser(me);
  if (!st) return false;
  collect(st);
  const ai = b.ai;
  const activeRaids = ctx.activeRaids;

  // 1) SAVUNMA: aktif saldırı altında mıyım?
  const activeDef = activeRaids[me];
  if (activeDef) {
    if (now >= activeDef.endsAt) {
      await finalizeRaid(activeDef, me, false, now);
      return true;
    }
    // Stratejik botlar erken püskürtür; agresifler bekler (sürpriz savunma = daha güçlü)
    if (Math.random() < (ai.strat / 100) * 0.75) {
      await finalizeRaid(activeDef, me, true, now);
      return true;
    }
    await saveUser(me, st);
    return false;
  }

  // Kendi saldırım varsa (saldırgan olarak) — bekle
  for (const id2 in activeRaids) {
    if (activeRaids[id2].a === me) { await saveUser(me, st); return false; }
  }

  // 2) İNTİKAM: son 30 dk içinde bana kazananla saldıran oldu mu?
  if (Math.random() < ai.venge / 100) {
    const grudges = await getGrudges(me);
    for (const g of grudges) {
      if (now - g.ts < 30 * 60 * 1000 && g.won && !activeRaids[g.a]) {
        const started = await startRaidAs(b, g.a, now, ctx);
        await saveUser(me, st);
        return started;
      }
    }
  }

  // 3) KOALİSYON: sürücülük yüksekse, saldırı altındaki bir hedefe katıl
  if (Math.random() < ai.pack / 100) {
    for (const id2 in activeRaids) {
      const r = activeRaids[id2];
      if (r.a !== me) {
        const started = await startRaidAs(b, id2, now, ctx);
        await saveUser(me, st);
        return started;
      }
    }
  }

  // 4) NORMAL SALDIRI
  if (Math.random() < ai.aggr / 100) {
    const target = pickTarget(st, b, ctx);
    if (target) {
      const started = await startRaidAs(b, target, now, ctx);
      await saveUser(me, st);
      return started;
    }
  }

  // 5) PASİF: gücünü artır (yükseltme al)
  const r2 = maybeInvest(st);
  await saveUser(me, st);
  await syncLb(me, st.name, st.totalEarned);
  return r2;
}

// ── Hedef seçimi (stratejiye göre güç aralığı) — ctx'ten okur, Redis yok ──
function pickTarget(st, b, ctx) {
  const myPow = raidPower(st);
  const { strat, aggr } = b.ai;
  const activeRaids = ctx.activeRaids;
  const cands = [];
  for (const { id, st: o } of ctx.users) {
    if (id === b.id || o.banned || activeRaids[id]) continue;
    const op = raidPower(o);
    let ok = false;
    if (strat > 70) ok = op > myPow * 0.35 && op < myPow * 1.05;      // akıllı: kazanabileceği
    else if (strat > 35) ok = op > myPow * 0.25 && op < myPow * 1.45; // orta: cesur
    else ok = true;                                                    // deli: herkes
    if (!ok) continue;
    cands.push({ id, name: o.name, op, bal: o.bal || 0 });
  }
  if (!cands.length) return null;
  if (strat > 55) {
    cands.sort((a, b2) => Math.abs(a.op - myPow) - Math.abs(b2.op - myPow));
  } else {
    cands.sort((a, b2) => (b2.bal * (aggr / 100)) - (a.bal * (aggr / 100)) || (a.op - b2.op));
  }
  return cands[0].id;
}

// ── Saldırı başlat (bot olarak) — ctx'ten okur ──
async function startRaidAs(b, targetId, now, ctx) {
  const tEntry = ctx.users.find((u) => u.id === targetId);
  const target = tEntry ? tEntry.st : await getUser(targetId);
  if (!target || target.banned) return false;
  if (ctx.activeRaids[targetId]) return false;
  const mEntry = ctx.users.find((u) => u.id === b.id);
  const st = mEntry ? mEntry.st : await getUser(b.id);
  if (!st) return false;
  collect(st);
  const raid = {
    a: b.id, aName: b.name || 'Bir arıcı',
    t: targetId, name: target.name || 'Arıcı',
    ats: now, endsAt: now + RAID_PREP_MS,
  };
  await setActiveRaid(targetId, raid);
  ctx.activeRaids[targetId] = raid; // aynı turda çakışma olmasın
  await addEvent({ type: 'war', emoji: '⚔️', txt: `${b.name} ${target.name}'in kovanına saldırıyor!` });
  await tgNotify(
    targetId,
    `⚠️ <b>SALDIRI UYARISI!</b>\n\n` +
    `🐝 <b>${escTg(b.name)}</b> kovanına saldırı başlattı!\n` +
    `⏳ Püskürtmek için <b>${Math.round(RAID_PREP_MS / 1000)} saniyen</b> var.\n\n` +
    `🛡️ Oyunu aç → <b>⚔️ Savaş</b> sekmesi → <b>Püskürt</b>!`
  );
  return true;
}

// ── Pasif güçlenme (yükseltme / arı alımı) ──
function maybeInvest(st) {
  // Bal biriktiren botlar kovan/depo yükseltir veya arı alır
  const prod = st.beesOwned;
  const act = Math.floor(Math.random() * 3);
  let did = false;
  if (act === 0 && st.bal > 2000) { st.bal -= 2000; st.kovan++; did = true; }
  else if (act === 1 && st.bal > 1000) { st.bal -= 1000; st.depo++; did = true; }
  else if (st.bal > 50) {
    const n = Math.min(5, Math.floor(st.bal / 40));
    if (n > 0) {
      st.bal -= n * 40;
      st.beesOwned += n;
      st.bees[1] += n;
      did = true;
    }
  }
  if (did) st.totalEarned += 0; // ekonomi görünümü korunur
  return did;
}

return {PERSONALITIES, NAME_POOL, AVATAR_POOL, randPick, randInt, randName, POWER_LEVELS, makeBotState, createBot, thinkBots};
})();

const __handlers = {};
__handlers['me'] = (() => {
// 🐝 POST /api/me — oyuncu girişi/oluşturma, üretim işleme, davet ödülleri
const { getUser, saveUser, getRef, setRef, syncLb, myRank, dbMode, getConfig, getActiveRaid, clearActiveRaid, addGrudge, getGrudges, addRaidHist, recentRaiders, tgNotify, getIncomingEmojis, clearIncomingEmojis } = __lib['db'];
const { newState, collect, checkAchievements, dailyInfo, playerLevel, setActiveCfg, getActiveCfg, REF_INVITER, REF_FRIEND, resolveRaid, coalitionBonus, mutualRaidPenalty, warLevel, prodMultiplier, questInfo, rollRainbow, rainbowActive, rollCircus, circusActive, rollAlien } = __lib['game'];
const { parseInitData } = __lib['auth'];

// Saldırı çözümünü paylaşmak için raid.js'teki finalizeRaid'i kullanmak yerine
// minimal bir kopya: burada yalnızca 'hedef girişi' tetikler. (raid.js döngüden kaçınmak için)
const { solveUserRaids } = __lib['raidcore'];
const { thinkBots } = __lib['brain'];

async function route(req, res) {
  try {
    return await handle(req, res);
  } catch (e) {
    console.error('me hatası:', e);
    if (!res.headersSent) return res.status(500).json({ error: 'sunucu_hatasi', detail: String(e?.message || e) });
  }
}

async function handle(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST bekleniyor' });
  const body = req.body || {};

  // Canlı konfigürasyon (admin paneli değişiklikleri anında geçerli)
  const cfg = await getConfig();
  setActiveCfg(cfg);
  if (cfg.maintenance) return res.status(503).json({ error: 'bakimda' });

  // 🤖 Dünya turu: botların "uyanma" vakti geldiyse hareket etsin
  // (60 sn'de en fazla 1 tur — kilitli, hata olursa sessizce geç)
  try { await thinkBots(); } catch (e) { console.error('🧠 thinkBots hatası:', e?.message || e); }

  let info = null;
  if (body.demo === true && process.env.ALLOW_DEMO === '1' && process.env.VERCEL_ENV !== 'production' && process.env.NODE_ENV !== 'production') {
    info = { user: { id: 1, first_name: 'Kanka', last_name: '' }, startParam: null };
  } else {
    info = parseInitData(body.initData);
  }
  if (!info) return res.status(401).json({ error: 'auth_hatasi' });

  const id = String(info.user.id);
  const name = [info.user.first_name, info.user.last_name].filter(Boolean).join(' ') || 'Anonim';

  let st = await getUser(id);
  let isNew = false;

  if (!st) {
    isNew = true;
    st = newState();
    st.name = name;

    // Davet zinciri: deep link ile gelen kod
    const code = info.startParam;
    if (code) {
      const inviter = await getRef(code);
      if (inviter && inviter !== id) {
        st.inviter = inviter;
        const inv = await getUser(inviter);
        if (inv) {
          inv.refs += 1;
          inv.bal += REF_INVITER;
          inv.totalEarned += REF_INVITER;
          await saveUser(inviter, inv);
          await syncLb(inviter, inv.name, inv.totalEarned);
        }
        st.bal += REF_FRIEND;
        st.totalEarned += REF_FRIEND;
      }
    }
    await setRef(id.toString(36), id);
    await saveUser(id, st);
  } else {
    st.name = name;
  }

  const now = Date.now();
  const collected = collect(st, now);
  // 🌈 Gökkuşağı: girişte %5 şans
  const rainbow = rollRainbow(st, now);
  // 🎪 Sirk: %3 şans
  const circus = rollCircus(st, now);
  // 👽 Uzaylı: %1 şans
  const alien = rollAlien(st, now);
  const gained = collected.gain || 0;

  // ⚔️ Evrensel çözüm: beni ilgilendiren süresi dolmuş saldırıları çöz
  let raidResult = null;
  if (!isNew) {
    const solved = await solveUserRaids(id, now);
    if (solved.length) {
      raidResult = solved[0];
      const updated = await getUser(id);
      if (updated) st = updated;
    }
  }

  const freshAch = checkAchievements(st, now);

  if (st.banned) {
    await saveUser(id, st);
    return res.status(403).json({ error: 'banlandin' });
  }

  await saveUser(id, st);
  await syncLb(id, name, st.totalEarned);

  res.json({
    ok: true,
    id,
    isNew,
    gained,
    freshAch,
    state: st,
    daily: dailyInfo(st, now),
    level: playerLevel(st),
    myRank: await myRank(id),
    dbMode: dbMode(),
    raidResult,
    night: prodMultiplier(now) > 1,
    boostActive: (st.boostUntil || 0) > now,
    boostUntil: st.boostUntil || 0,
    canSpin: (st.lastSpin || 0) < Math.floor(now / 86400000) * 86400000,
    quests: questInfo(st, now),
    rainbow: rainbow ? { until: rainbow.until } : null,
    rainbowActive: rainbowActive(st, now),
    circus: circus ? { until: circus.until } : null,
    circusActive: circusActive(st, now),
    alien: alien ? { stardust: alien.stardust, gift: alien.gift } : null,
    stardust: st.stardust || 0,
    cosmetics: st.cosmetics || [],
    incomingEmojis: await popIncomingEmojis(id),
    demo: !!info.demo,
    cfg: {
      bot: process.env.BOT_USERNAME || '',
      appUrl: process.env.APP_URL || '',
      vzvzCooldownSec: Math.round(cfg.vzvzCooldownMs / 1000),
      vzvzDurationSec: Math.round(cfg.vzvzMaxMs / 1000),
      // ekonomi — istemci de aynı değerleri kullansın (admin değişince anında yansır)
      ...getActiveCfg(),
    },
  });
}

// 💥 Gelen emoji bombalarını oku ve temizle (oyuncu oyuna girince tek seferlik)
async function popIncomingEmojis(id) {
  const list = await getIncomingEmojis(id);
  if (list.length) await clearIncomingEmojis(id);
  return list;
}

return route;
})();
__handlers['action'] = (() => {
// 🐝 POST /api/action — oyun aksiyonları (tek uç, tek doğrulama noktası)
// Aksiyonlar: collect | buy_bee | upgrade | daily | vzvz_end
const { getUser, saveUser, syncLb, myRank, getConfig, bumpCounter, addIncomingEmoji, addEvent, tgNotify, getIncomingEmojis, clearIncomingEmojis } = __lib['db'];
const { escTg } = __lib['raidcore'];
const { collect, buyBee, upgrade, claimDaily, vzvzPlay, checkAchievements, dailyInfo, playerLevel, setActiveCfg, newState, spinWheel, openChest, throwEmoji, THROW_EMOJI_COST, questProgress, questClaim, questInfo, warLevel, playBalloon, playTimer, playMaze, buyCosmetic } = __lib['game'];
const { parseInitData } = __lib['auth'];

async function route(req, res) {
  try {
    return await handle(req, res);
  } catch (e) {
    console.error('action hatası:', e);
    if (!res.headersSent) return res.status(500).json({ error: 'sunucu_hatasi', detail: String(e?.message || e) });
  }
}

async function handle(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST bekleniyor' });
  const body = req.body || {};

  // Canlı konfigürasyon
  const cfg = await getConfig();
  setActiveCfg(cfg);
  if (cfg.maintenance) return res.status(503).json({ error: 'bakimda' });

  let info = null;
  if (body.demo === true && process.env.ALLOW_DEMO === '1' && process.env.VERCEL_ENV !== 'production' && process.env.NODE_ENV !== 'production') {
    info = { user: { id: 1, first_name: 'Kanka', last_name: '' }, startParam: null };
  } else {
    info = parseInitData(body.initData);
  }
  if (!info) return res.status(401).json({ error: 'auth_hatasi' });

  const id = String(info.user.id);
  const me = id;
  let st = await getUser(id);
  if (!st) return res.status(404).json({ error: 'oyuncu_yok' });
  if (st.banned) return res.status(403).json({ error: 'banlandin' });

  const now = Date.now();
  const balBefore = st.bal;
  const collected = collect(st, now); // her işlemde bekleyen üretim işlenir
  const gained = st.bal - balBefore;

  const action = body.action;
  const payload = body.payload || {};
  let result = {};

  switch (action) {
    case 'collect':
      if (gained > 0) questProgress(st, 'collect', 1, now);
      result = { collected: gained };
      break;
    case 'buy_bee': {
      const r = buyBee(st, 1);
      if (!r.ok) return res.status(400).json({ error: r.why });
      questProgress(st, 'buy', 1, now);
      result = { cost: r.cost, merges: r.merges };
      break;
    }
    case 'upgrade': {
      if (payload.which !== 'kovan' && payload.which !== 'depo') return res.status(400).json({ error: 'bilinmeyen_yukseltme' });
      const r = upgrade(st, payload.which);
      if (!r.ok) return res.status(400).json({ error: r.why });
      result = { cost: r.cost, which: payload.which };
      break;
    }
    case 'daily': {
      const r = claimDaily(st, now);
      if (!r) return res.status(400).json({ error: 'bugun_aldi' });
      result = r;
      break;
    }
    case 'rename': {
      const nm = String(payload.name || '').replace(/<[^>]*>/g, '').trim().slice(0, 24);
      if (!nm) return res.status(400).json({ error: 'isim_gerekli' });
      st.name = nm;
      result = { name: nm };
      break;
    }
    case 'avatar': {
      const av = String(payload.avatar || '').trim();
      if (!av || [...av].length > 2) return res.status(400).json({ error: 'avatar_gecersiz' });
      st.avatar = av;
      result = { avatar: av };
      break;
    }
    case 'reset_me': {
      const keepName = st.name;
      const keepAvatar = st.avatar;
      st = newState();
      st.name = keepName;
      if (keepAvatar) st.avatar = keepAvatar;
      result = { reset: true };
      break;
    }
    case 'vzvz_end': {
      const r = vzvzPlay(st, Number(payload.taps) || 0, Number(payload.durMs) || 0, now);
      if (!r.ok) return res.status(400).json({ error: r.why });
      questProgress(st, 'vzvz', 1, now);
      result = r;
      break;
    }
    case 'spin': {
      const r = spinWheel(st, now);
      if (!r.ok) return res.status(400).json({ error: r.why });
      await bumpCounter('spin');
      questProgress(st, 'spin', 1, now);
      result = r;
      break;
    }
    case 'chest': {
      const card = Math.max(0, Math.min(2, Number(payload.card) || 0));
      const r = openChest(st, card, now);
      if (!r.ok) return res.status(400).json({ error: r.why });
      result = r;
      break;
    }
    case 'minigame': {
      const game = payload.game;
      if (game === 'balloon') {
        const r = playBalloon(st, Math.floor(Number(payload.score) || 0), now);
        if (!r.ok) return res.status(400).json({ error: r.why });
        result = r;
      } else if (game === 'timer') {
        const r = playTimer(st, Number(payload.stoppedAt) || 0, Number(payload.target) || 0, now);
        if (!r.ok) return res.status(400).json({ error: r.why });
        result = r;
      } else return res.status(400).json({ error: 'bilinmeyen_oyun' });
      break;
    }
    case 'maze': {
      const r = playMaze(st, Math.floor(Number(payload.level) || 1), Math.floor(Number(payload.flowers) || 0), !!payload.won, now);
      if (!r.ok) return res.status(400).json({ error: r.why });
      result = r;
      break;
    }
    case 'market_buy': {
      const r = buyCosmetic(st, String(payload.itemId || ''), now);
      if (!r.ok) return res.status(400).json({ error: r.why });
      result = r;
      break;
    }
    case 'quest_claim': {
      const r = questClaim(st, String(payload.questId || ''), now);
      if (!r.ok) return res.status(400).json({ error: r.why });
      result = r;
      break;
    }
    case 'throw_emoji': {
      const targetId = String(payload.targetId || '');
      const emoji = String(payload.emoji || '');
      if (!targetId || targetId === me) return res.status(400).json({ error: 'hedef_gecersiz' });
      const target = await getUser(targetId);
      if (!target) return res.status(404).json({ error: 'hedef_yok' });
      if (target.banned) return res.status(400).json({ error: 'hedef_banli' });
      const r = throwEmoji(st, targetId, emoji, now);
      if (!r.ok) return res.status(400).json({ error: r.why });
      await addIncomingEmoji(targetId, { by: me, byName: st.name || 'Bir arıcı', emoji, ts: now });
      await addEvent({ type: 'emoji', emoji: '💥', txt: `${st.name || 'Bir arıcı'}, ${target.name || 'Bir arıcı'}'e ${emoji} fırlattı!` });
      await tgNotify(targetId, `💥 ${escTg(st.name || 'Bir arıcı')} sana ${emoji} fırlattı! 😂 Oyunu aç ve gör!`);
      result = { emoji, targetId, cost: THROW_EMOJI_COST };
      break;
    }
    default:
      return res.status(400).json({ error: 'bilinmeyen_aksiyon' });
  }

  const freshAch = checkAchievements(st, now);
  await saveUser(id, st);
  await syncLb(id, st.name, st.totalEarned);

  res.json({
    ok: true,
    ...result,
    state: st,
    freshAch,
    daily: dailyInfo(st, now),
    level: playerLevel(st),
    war: warLevel(st.xp || 0),
    myRank: await myRank(id),
    quests: questInfo(st, now),
  });
}

return route;
})();
__handlers['raid'] = (() => {
// ⚔️ POST /api/raid — Bal Baskını (PvP)
// Aksiyonlar: world | start | defend | cancel
// Lazy çözüm: her çağrıda süresi dolmuş ve henüz çözülmemiş saldırıları çözer.
const { getUser, saveUser, getActiveRaid, setActiveRaid, clearActiveRaid, getGrudges, tgNotify, syncLb, allUsers, getConfig, allActiveRaids, getEvents } = __lib['db'];
const { setActiveCfg, resolveRaid, raidPower, warLevel, collect, checkAchievements, playerLevel } = __lib['game'];
const { parseInitData } = __lib['auth'];
const { finalizeRaid, RAID_PREP_MS, solveUserRaids, escTg } = __lib['raidcore'];
const { thinkBots } = __lib['brain'];

async function route(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST bekleniyor' });
  const body = req.body || {};

  // 🤖 Savaş sekmesi açılınca dünya canlansın
  try { await thinkBots(); } catch (e) { console.error('🧠 thinkBots hatası:', e?.message || e); }

  let info = null;
  if (body.demo === true && process.env.ALLOW_DEMO === '1' && process.env.VERCEL_ENV !== 'production' && process.env.NODE_ENV !== 'production') {
    info = { user: { id: 1, first_name: 'Kanka', last_name: '' }, startParam: null };
  } else {
    info = parseInitData(body.initData);
  }
  if (!info) return res.status(401).json({ error: 'auth_hatasi' });

  const me = String(info.user.id);
  let st = await getUser(me);
  if (!st) return res.status(404).json({ error: 'oyuncu_yok' });
  if (st.banned) return res.status(403).json({ error: 'banlandin' });

  setActiveCfg(await getConfig());
  collect(st);

  const now = Date.now();
  const action = body.action;
  const result = {};

  // ── Önce: beni ilgilendiren SÜRESİ DOLMUŞ saldırıları çöz (hem savunma hem saldırı) ──
  const solved = await solveUserRaids(me, now);
  if (solved.length) {
    result.solved = solved;
    st = await getUser(me); // çözüm sonrası taze state
  }

  switch (action) {
    case 'world': {
      // Aktif saldırılar tek okuma (performans)
      const actAll = await allActiveRaids();
      // Kendi aktif saldırım (saldırgan olarak)
      let myAttack = null;
      for (const id2 in actAll) {
        if (actAll[id2].a === me) { myAttack = actAll[id2]; break; }
      }
      // Aktif savunma (hedef olarak)
      const myDefense = actAll[me] || null;
      const all = await allUsers(400);

      // Hedef önerileri: güç benzeri oyuncular (ban harici)
      const myPow = raidPower(st);
      // ⚡ Aktif saldırılar TEK istekte toplanır (400 ayrı getActiveRaid YOK)
      const activeAll = await allActiveRaids();
      const buildTargets = (lo, hi) => {
        const list = [];
        for (const { id, st: o } of all) {
          if (String(id) === me || o.banned) continue;
          if (activeAll[id]) continue; // o zaten saldırı altında
          const op = raidPower(o);
          if (op < myPow * lo) continue;
          if (op > myPow * hi) continue;
          list.push({
            id, name: o.name, avatar: o.avatar || '🐝',
            level: playerLevel(o).level, war: warLevel(o.xp || 0).level,
            power: Math.round(op), bal: Math.round(o.bal || 0), bees: o.beesOwned,
            grudge: (o.grudgeDef || 0),
          });
          if (list.length >= 6) break;
        }
        list.sort((a, b) => Math.abs(a.power - myPow) - Math.abs(b.power - myPow));
        return list;
      };
      // 1. aşama: güç dengeli hedefler · 2. aşama (boşsa): geniş aralık — "cesur hedef"
      let targets = buildTargets(0.3, 3);
      let brave = false;
      if (targets.length === 0) {
        targets = buildTargets(0.15, 4);
        brave = true;
      }
      // 3. aşama (hâlâ boşsa): güç filtresi yok — en yakın rakipler, uyarıyla
      if (targets.length === 0) {
        for (const { id, st: o } of all) {
          if (String(id) === me || o.banned) continue;
          if (activeAll[id]) continue;
          targets.push({
            id, name: o.name, avatar: o.avatar || '🐝',
            level: playerLevel(o).level, war: warLevel(o.xp || 0).level,
            power: Math.round(raidPower(o)), bal: Math.round(o.bal || 0), bees: o.beesOwned,
            grudge: (o.grudgeDef || 0),
          });
          if (targets.length >= 6) break;
        }
        targets.sort((a, b) => Math.abs(a.power - myPow) - Math.abs(b.power - myPow));
        brave = true;
      }

      const grudges = (await getGrudges(me)).slice(0, 10).map((g) => ({
        by: g.a, name: g.name, ts: g.ts, won: g.won, stolen: Math.round(g.stolen || 0),
      }));

      result.world = {
        myPower: Math.round(myPow),
        myWar: warLevel(st.xp || 0),
        targets,
        brave,
        grudges,
        events: (await getEvents()).slice(0, 15),
        myAttack: myAttack ? { targetId: myAttack.t, endsAt: myAttack.endsAt, now } : null,
        myDefense: myDefense ? { attacker: myDefense.a, name: myDefense.name, endsAt: myDefense.endsAt, now } : null,
      };
      break;
    }

    case 'start':
    case 'revenge': {
      const targetId = String(body.targetId || '');
      if (!targetId || targetId === me) return res.status(400).json({ error: 'hedef_gecersiz' });
      const target = await getUser(targetId);
      if (!target) return res.status(404).json({ error: 'hedef_yok' });
      if (target.banned) return res.status(400).json({ error: 'hedef_banli' });
      if (await getActiveRaid(targetId)) return res.status(400).json({ error: 'hedef_saldiri_altinda' });
      // Saldırgan zaten birine saldırıyorsa yeni saldırı başlatamaz
      // ⚡ Tek toplu okuma (her kullanıcı için ayrı istek yok)
      const activeAll = await allActiveRaids();
      for (const id2 in activeAll) {
        if (activeAll[id2].a === me) return res.status(400).json({ error: 'zaten_saldiriyorsun' });
      }
      if (activeAll[me]) return res.status(400).json({ error: 'savunmadasin' });

      const raid = {
        a: me,
        aName: st.name || 'Arıcı',
        t: targetId,
        name: target.name || 'Arıcı',
        ats: now,
        endsAt: now + RAID_PREP_MS,
      };
      await setActiveRaid(targetId, raid);

      // 📢 Kurbanına Telegram bildirimi!
      await tgNotify(
        targetId,
        `⚠️ <b>SALDIRI UYARISI!</b>\n\n` +
        `🐝 <b>${escTg(st.name || 'Bir arıcı')}</b> kovanına saldırı başlattı!\n` +
        `⏳ Püskürtmek için <b>${Math.round(RAID_PREP_MS / 1000)} saniyen</b> var.\n\n` +
        `🛡️ Oyunu aç → <b>⚔️ Savaş</b> sekmesi → <b>Püskürt</b>!\n` +
        `(Süre dolarsa arıların hasar alır!)`
      );

      result.raid = { targetId, endsAt: raid.endsAt, now };
      break;
    }

    case 'defend': {
      const active2 = await getActiveRaid(me);
      if (!active2) return res.status(400).json({ error: 'saldiri_yok' });
      if (now < active2.endsAt) {
        // Süre dolmadıysa erken püskürtme: aktif savunma gücüyle hemen çöz
        const resolved = await finalizeRaid(active2, me, true, now);
        result.defend = resolved;
      } else {
        // Süre dolduysa lazy çözüm zaten yaptı
        result.defend = { note: 'zaman_doldu' };
      }
      break;
    }

    case 'cancel': {
      // Saldırgan kendi saldırısını iptal eder → çürüme cezası
      const activeAll2 = await allActiveRaids();
      let found = null;
      for (const id2 in activeAll2) {
        if (activeAll2[id2].a === me) { found = activeAll2[id2]; break; }
      }
      if (!found) return res.status(400).json({ error: 'saldiri_yok' });
      await clearActiveRaid(found.t);
      st.xp = Math.max(0, (st.xp || 0) - 10); // çürüme cezası
      await saveUser(me, st);
      result.cancel = { penalty: 10 };
      break;
    }

    default:
      return res.status(400).json({ error: 'bilinmeyen_aksiyon' });
  }

  const freshAch = checkAchievements(st, now);
  await saveUser(me, st);
  await syncLb(me, st.name, st.totalEarned);

  res.json({
    ok: true,
    ...result,
    state: st,
    freshAch,
    level: playerLevel(st),
    war: warLevel(st.xp || 0),
  });
}

return route;
})();
__handlers['admin'] = (() => {
// 👑 POST /api/admin/* — Tanrı Modu (admin paneli)
// Kimlik doğrulama: iki yöntemden biri yeterli:
//   1) OWNER_ID env'i + Telegram initData (bot içinden /admin butonu ile)
//   2) ADMIN_PASSWORD env'i + şifre (admin.html'de şifre girişi)
// Başarılı giriş → Redis'te 12 saatlik oturum token'ı → sonraki istekler
// "Authorization: Bearer <token>" başlığıyla.
const { getUser, saveUser, getConfig, setConfig, createSession, getSession, deleteSession, allUsers, overview, listBots, getBot, deleteBot } = __lib['db'];
const { newState, setActiveCfg, getActiveCfg, giveAchievement, playerLevel, ACHIEVEMENTS, MAX_LEVEL, beeCost, kovanCost, depoCost, capacity, totalProd } = __lib['game'];
const { parseInitData } = __lib['auth'];
const { createBot, thinkBots, PERSONALITIES, POWER_LEVELS, makeBotState, randPick, AVATAR_POOL } = __lib['brain'];

const OWNER_ID = process.env.OWNER_ID;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

async function issueToken(id) {
  const token = crypto.randomBytes(24).toString('hex');
  await createSession(token, id);
  return token;
}

async function route(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST bekleniyor' });
  const body = req.body || {};
  const action = body.action;

  // ── Giriş ──
  if (action === 'auth') {
    if (ADMIN_PASSWORD && typeof body.password === 'string' && body.password.length > 0) {
      if (safeEqual(body.password, ADMIN_PASSWORD)) {
        return res.json({ ok: true, token: await issueToken('admin'), method: 'password' });
      }
      return res.status(401).json({ error: 'yanlis_sifre' });
    }
    if (OWNER_ID && body.initData) {
      const info = parseInitData(body.initData);
      if (info && String(info.user.id) === String(OWNER_ID)) {
        return res.json({ ok: true, token: await issueToken(String(info.user.id)), method: 'telegram' });
      }
      return res.status(401).json({ error: 'yetki_yok' });
    }
    return res.status(400).json({
      error: 'admin_ayarsiz',
      detail: 'Vercel ortam değişkenlerine ADMIN_PASSWORD (veya OWNER_ID) eklemedin. (README → Tanrı Modu bölümü)',
    });
  }

  // ── Diğer tüm işlemler: oturum gerekli ──
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'oturum_yok' });
  const sessionId = await getSession(token);
  if (!sessionId) return res.status(401).json({ error: 'oturum_gecersiz' });

  // Admin işlemleri ekonomi konfigürasyonunu güncel tutsun
  setActiveCfg(await getConfig());

  try {
    switch (action) {
      case 'overview': {
        const o = await overview();
        const top = (await allUsers(500))
          .sort((a, b) => (b.st.totalEarned || 0) - (a.st.totalEarned || 0))
          .slice(0, 10)
          .map((x) => ({ id: x.id, name: x.st.name, totalEarned: x.st.totalEarned, bal: x.st.bal, banned: !!x.st.banned }));
        return res.json({ ok: true, stats: { ...o, top } });
      }

      case 'search': {
        const q = String(body.q || '').toLowerCase().trim();
        const users = await allUsers(5000);
        const matched = users
          .filter((x) => !q || x.id.includes(q) || String(x.st.name || '').toLowerCase().includes(q))
          .slice(0, 40)
          .map((x) => ({
            id: x.id, name: x.st.name, bal: Math.round(x.st.bal || 0),
            totalEarned: Math.round(x.st.totalEarned || 0), beesOwned: x.st.beesOwned,
            level: playerLevel(x.st).level, banned: !!x.st.banned,
            lastSeen: x.st.lastSeen || 0, ach: (x.st.ach || []).length,
          }));
        return res.json({ ok: true, players: matched, total: matched.length });
      }

      case 'player': {
        const st = await getUser(String(body.id));
        if (!st) return res.status(404).json({ error: 'oyuncu_yok' });
        return res.json({
          ok: true,
          player: {
            id: body.id, state: st, level: playerLevel(st),
            costs: { bee: beeCost(st), kovan: kovanCost(st), depo: depoCost(st) },
            prod: totalProd(st), cap: capacity(st),
          },
        });
      }

      case 'player_update': {
        const id = String(body.id);
        let st = await getUser(id);
        if (!st) return res.status(404).json({ error: 'oyuncu_yok' });
        const act = body.action2;
        const amount = Math.floor(Number(body.amount) || 0);

        switch (act) {
          case 'add_bal': {
            st.bal += amount;
            if (amount > 0) st.totalEarned += amount;
            break;
          }
          case 'set_bal': {
            st.bal = Math.max(0, amount);
            break;
          }
          case 'add_bees': {
            st.beesOwned += amount;
            st.bees[1] += amount;
            for (let l = 1; l < MAX_LEVEL; l++) {
              while (st.bees[l] >= 2) { st.bees[l] -= 2; st.bees[l + 1]++; }
            }
            break;
          }
          case 'give_ach': {
            const r = giveAchievement(st, body.achId);
            if (!r.ok) return res.status(400).json({ error: r.why });
            break;
          }
          case 'remove_ach': {
            const a = ACHIEVEMENTS.find((x) => x.id === body.achId);
            if (!a) return res.status(400).json({ error: 'rozet_yok' });
            st.ach = st.ach.filter((x) => x !== body.achId);
            break;
          }
          case 'rename': {
            const nm = String(body.name || '').trim().slice(0, 24);
            if (!nm) return res.status(400).json({ error: 'isim_gerekli' });
            st.name = nm;
            break;
          }
          case 'ban': st.banned = true; break;
          case 'unban': st.banned = false; break;
          case 'reset': {
            st = newState();
            st.name = body.name || 'Arıcı';
            break;
          }
          default:
            return res.status(400).json({ error: 'bilinmeyen_islem' });
        }
        await saveUser(id, st);
        return res.json({ ok: true, player: { id, name: st.name, bal: Math.round(st.bal), totalEarned: Math.round(st.totalEarned), beesOwned: st.beesOwned, banned: !!st.banned, ach: st.ach } });
      }

      case 'gift': {
        // Tüm oyunculara +bal (etkinlik hediyesi)
        const amount = Math.floor(Number(body.amount) || 0);
        if (amount <= 0) return res.status(400).json({ error: 'miktar_gerekli' });
        const users = await allUsers(2000);
        let affected = 0;
        for (const { id, st } of users) {
          if (st.banned) continue;
          st.bal += amount;
          st.totalEarned += amount;
          await saveUser(id, st);
          affected++;
        }
        return res.json({ ok: true, affected, amount });
      }

      case 'config_get':
        return res.json({ ok: true, config: getActiveCfg() });

      case 'config_set': {
        const patch = body.config || {};
        const allowed = [
          'beeBaseCost', 'beeCostGrowth', 'p1', 'pMult', 'capBase', 'capUpgMult',
          'capUpgBase', 'capUpgCostMult', 'kovanBase', 'kovanCostMult',
          'startBal', 'startFreeBees', 'vzvzTapReward', 'vzvzMaxTaps', 'vzvzMaxMs',
          'vzvzCooldownMs', 'dailyEnabled', 'vzvzEnabled', 'maintenance',
        ];
        const clean = {};
        for (const k of allowed) {
          if (patch[k] !== undefined) {
            const v = typeof patch[k] === 'boolean' ? patch[k] : Number(patch[k]);
            if (k === 'dailyEnabled' || k === 'vzvzEnabled' || k === 'maintenance') clean[k] = !!patch[k];
            else if (Number.isFinite(v) && v >= 0) clean[k] = v;
          }
        }
        const next = await setConfig(clean);
        setActiveCfg(next);
        return res.json({ ok: true, config: next });
      }

      case 'session_info':
        return res.json({ ok: true, session: sessionId });

      case 'bot_list': {
        const bots = await listBots();
        const out = [];
        for (const b of bots) {
          const st = await getUser(b.id);
          out.push({
            id: b.id, name: b.name, avatar: b.avatar, personality: b.personality,
            personalityLabel: PERSONALITIES[b.personality]?.label || b.personality,
            powerLevel: b.powerLevel, ai: b.ai, enabled: b.enabled,
            lastThink: b.lastThink || 0, created: b.created || 0,
            state: st ? {
              bal: Math.round(st.bal || 0), beesOwned: st.beesOwned,
              xp: st.xp || 0, war: playerLevel(st).level,
              raidWins: st.raidWins || 0, raidLosses: st.raidLosses || 0,
              defended: st.defended || 0, grudgeDef: st.grudgeDef || 0,
              totalEarned: Math.round(st.totalEarned || 0),
            } : null,
          });
        }
        return res.json({ ok: true, bots: out, personalities: PERSONALITIES, powerLevels: POWER_LEVELS });
      }

      case 'bot_create': {
        const count = Math.min(Math.max(parseInt(body.count) || 1, 1), 50);
        const personality = PERSONALITIES[body.personality] ? body.personality : 'warrior';
        const powerLevel = POWER_LEVELS[body.powerLevel] ? body.powerLevel : 'orta';
        const enabled = body.enabled !== false;
        const created = [];
        for (let i = 0; i < count; i++) {
          created.push(await createBot({ personality, powerLevel, enabled }));
        }
        return res.json({ ok: true, created: created.map((b) => ({ id: b.id, name: b.name, avatar: b.avatar, personality })) });
      }

      case 'bot_update': {
        const id = String(body.id || '');
        const bot = await getBot(id);
        if (!bot) return res.status(404).json({ error: 'bot_yok' });
        if (body.name) bot.name = String(body.name).trim().slice(0, 24) || bot.name;
        if (body.avatar && [...String(body.avatar)].length <= 2) bot.avatar = String(body.avatar);
        if (PERSONALITIES[body.personality]) bot.personality = body.personality;
        if (POWER_LEVELS[body.powerLevel]) bot.powerLevel = body.powerLevel;
        if (body.enabled !== undefined) bot.enabled = !!body.enabled;
        if (body.ai && typeof body.ai === 'object') {
          for (const k of ['aggr', 'strat', 'venge', 'pack']) {
            const v = parseInt(body.ai[k]);
            if (Number.isFinite(v)) bot.ai[k] = Math.min(100, Math.max(0, v));
          }
        }
        // Güç seviyesi değiştiyse oyuncu durumunu yeniden şekillendir
        if (body.powerLevel && POWER_LEVELS[body.powerLevel]) {
          const st = makeBotState(body.powerLevel);
          st.name = bot.name;
          st.avatar = bot.avatar;
          await saveUser(id, st);
        } else {
          const st = await getUser(id);
          if (st) {
            if (body.name) st.name = bot.name;
            if (body.avatar) st.avatar = bot.avatar;
            await saveUser(id, st);
          }
        }
        await saveBot(bot);
        return res.json({ ok: true, bot });
      }

      case 'bot_delete': {
        const id = String(body.id || '');
        if (!(await getBot(id))) return res.status(404).json({ error: 'bot_yok' });
        await deleteBot(id);
        return res.json({ ok: true });
      }

      case 'bot_toggle': {
        const id = String(body.id || '');
        const bot = await getBot(id);
        if (!bot) return res.status(404).json({ error: 'bot_yok' });
        bot.enabled = body.enabled !== undefined ? !!body.enabled : !bot.enabled;
        await saveBot(bot);
        return res.json({ ok: true, enabled: bot.enabled });
      }

      case 'bot_run': {
        const r = await thinkBots({ force: true });
        return res.json({ ok: true, ...r });
      }

      case 'logout':
        await deleteSession(token);
        return res.json({ ok: true });

      default:
        return res.status(400).json({ error: 'bilinmeyen_aksiyon' });
    }
  } catch (e) {
    console.error('admin hatası:', e);
    return res.status(500).json({ error: 'sunucu_hatasi', detail: String(e?.message || e) });
  }
}

return route;
})();
__handlers['leaderboard'] = (() => {
// 🏆 GET /api/leaderboard — en iyi 30 arıcı
// mode=today → bugünün kazançları · mode=week → haftalık · mode=cnt → dünya sayaçları
// mode=ticker → kayan bant verisi (events + counters + bugünün kazançları)
const { topLb, topToday, topWeekly, getCounters, getEvents } = __lib['db'];

async function route(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET bekleniyor' });
  const mode = new URL(req.url, 'http://x').searchParams.get('mode') || 'all';
  if (mode === 'today') {
    const top = await topToday(10);
    return res.json({ ok: true, top });
  }
  if (mode === 'week') {
    const top = await topWeekly(10);
    return res.json({ ok: true, top });
  }
  if (mode === 'cnt') {
    const c = await getCounters();
    const wk = await topWeekly(10);
    const weekTotal = wk.reduce((a, x) => a + x.score, 0);
    return res.json({ ok: true, warCount: c.war || 0, spinCount: c.spin || 0, weekTotal });
  }
  if (mode === 'ticker') {
    const [events, c, today] = await Promise.all([getEvents(), getCounters(), topToday(3)]);
    return res.json({ ok: true, events: events.slice(0, 15), counters: c, today });
  }
  const top = await topLb(30);
  res.json({ ok: true, top });
}

return route;
})();
__handlers['bot'] = (() => {
// 🤖 POST /api/bot — Telegram bot webhook'u (Telegraf)
// Bot sadece kapı: /start ile karşılama + Mini App butonu.
// Oyunun kendisi Mini App'te (index.html) çalışır.

const token = process.env.BOT_TOKEN;
const appUrl = process.env.APP_URL;
const bot = token ? new Telegraf(token) : null;

if (bot) {
  bot.start(async (ctx) => {
    const kb = Markup.inlineKeyboard([
      [Markup.button.webApp('🎮 Oyunu Aç', appUrl)],
    ]);
    await ctx.reply(
      `🐝 Hoş geldin, ${ctx.from.first_name}!\n\n` +
        `Bal Vakti: arı al 🐝, birleştir ✨, bal üret 🍯, rozet topla 🏅, arkadaşlarınla yarış! 🏆\n\n` +
        `💰 Para yok, sadece eğlence. Hemen başla 👇`,
      kb
    );
    try {
      await ctx.telegram.setChatMenuButton({
        chat_id: ctx.chat.id,
        menu_button: { type: 'web_app', text: '🎮 Oyna', web_app: { url: appUrl } },
      });
    } catch (e) {
      /* menü butonu set edilemezse sorun değil */
    }
  });

  bot.command('oyna', (ctx) =>
    ctx.reply('Oyunu aç 👇', Markup.inlineKeyboard([[Markup.button.webApp('🎮 Oyna', appUrl)]]))
  );

  bot.command('admin', (ctx) => {
    const uid = String(ctx.from.id);
    const owner = process.env.OWNER_ID;
    if (!owner) {
      return ctx.reply(
        `👑 Tanrı Modu kurulmamış.\n\nSenin Telegram ID'n: <code>${uid}</code>\n` +
        `Bu ID'yi Vercel ortam değişkenlerine <b>OWNER_ID</b> olarak ekle (veya ADMIN_PASSWORD belirle) ve redeploy et.`,
        { parse_mode: 'HTML' }
      );
    }
    if (uid !== owner) {
      return ctx.reply(
        `⛔ Bu komut yalnızca bot sahibine özeldir.\n\n` +
        `🔍 <b>Senin Telegram ID'n:</b> <code>${uid}</code>\n` +
        `Vercel'deki <b>OWNER_ID</b>: <code>${owner}</code>\n\n` +
        `Eşleşmiyor! Vercel → Settings → Environment Variables → OWNER_ID'i <code>${uid}</code> olarak güncelle ve redeploy et.`,
        { parse_mode: 'HTML' }
      );
    }
    ctx.reply(
      '👑 Tanrı Modu — oyuncu yönetimi, bonuslar, canlı ekonomi ayarları.',
      Markup.inlineKeyboard([[Markup.button.webApp('👑 Admin Panel', appUrl + '/admin.html')]])
    );
  });

  bot.help((ctx) =>
    ctx.reply(
      '🐝 Bal Vakti komutları:\n' +
        '/start — karşılama + oyunu aç\n' +
        '/oyna — oyunu aç\n' +
        '/admin — tanrı modu (yalnızca sahip)\n\n' +
        'Arkadaşlarını davet et, ikiniz de bonus bal kazanın! 🎁'
    )
  );
}

async function route(req, res) {
  if (req.method === 'POST') {
    if (!bot) return res.status(500).json({ error: 'BOT_TOKEN tanımlı değil' });
    try {
      // ⚠️ res'i Telegraf'a VERME — Vercel'in res objesinde send() yok,
      // Telegraf res.send() çağırınca hata fırlar ve bot sessizce ölür.
      // Res'siz çağırırız, cevabı kendimiz yazarız.
      await bot.handleUpdate(req.body);
      if (!res.headersSent) res.json({ ok: true });
    } catch (e) {
      console.error('Webhook hatası:', e);
      if (!res.headersSent) res.status(500).json({ error: 'webhook_hatasi', detail: String(e?.message || e) });
    }
    return;
  }
  res.status(200).json({ ok: true, bot: !!bot, appUrl: appUrl || null });
}

return route;
})();

// ── Router ──
const ROUTES = {
  '/api/me': __handlers.me,
  '/api/action': __handlers.action,
  '/api/raid': __handlers.raid,
  '/api/admin': __handlers.admin,
  '/api/leaderboard': __handlers.leaderboard,
  '/api/bot': __handlers.bot,
};

export default async function handler(req, res) {
  const pathname = (req.url || '/').split('?')[0];
  const fn = ROUTES[pathname];
  if (!fn) {
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ error: 'yok' }));
  }
  try {
    await fn(req, res);
  } catch (e) {
    console.error('router hatası:', e);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'sunucu_hatasi', detail: String(e?.message || e) }));
    }
  }
}
