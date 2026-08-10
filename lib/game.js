// 🐝 Bal Vakti — oyun mantığı (saf fonksiyonlar)
// Tüm ekonomi burada; sunucu tarafı otoriteli (istemciye güvenilmez).
// NOT: Ekonomi değerleri DEFAULT_CONFIG üzerinden okunur. Admin paneli
// (lib/db.js → getConfig) bu değerleri canlı olarak değiştirebilir;
// sunucu her istekte setActiveCfg(await getConfig()) çağırır.

export const MAX_LEVEL = 12;

// ── Ekonomi parametreleri (varsayılan; admin paneli canlı değiştirebilir) ──
export const DEFAULT_CONFIG = {
  beeBaseCost: 10,       // 1. seviye arı taban fiyatı
  beeCostGrowth: 1.09,   // her arıda fiyat %9 artar
  p1: 0.25,              // 1. seviye arı: bal/sn
  pMult: 3,              // her seviye 3x üretim
  capBase: 500,          // başlangıç depo kapasitesi
  capUpgMult: 4,         // depo seviyesi başına 4x kapasite
  capUpgBase: 200,       // depo yükseltme taban fiyatı
  capUpgCostMult: 3,
  kovanBase: 400,        // kovan (üretim x2) taban fiyatı
  kovanCostMult: 4,
  startBal: 25,          // yeni oyuncu başlangıç balı
  startFreeBees: 1,      // yeni oyuncuya ücretsiz arı
  vzvzTapReward: 2,      // VızVız: dokunuş başına bal
  vzvzMaxTaps: 30,       // VızVız hile koruması: max dokunuş
  vzvzMaxMs: 12000,      // VızVız hile koruması: max süre
  vzvzCooldownMs: 300000, // VızVız bekleme (5 dk)
  dailyEnabled: true,    // günlük ödül açık/kapalı
  vzvzEnabled: true,     // VızVız açık/kapalı
  maintenance: false,    // bakım modu (oyun kapanır)
};

// Aktif konfigürasyon (her istekte db.getConfig() ile set edilir)
let ACTIVE_CFG = DEFAULT_CONFIG;
export function setActiveCfg(c) { ACTIVE_CFG = c || DEFAULT_CONFIG; }
export function getActiveCfg() { return ACTIVE_CFG; }

export const DAILY_REWARDS = [50, 100, 200, 400, 800, 1600, 3000]; // 7 günlük seri
export const REF_INVITER = 100;       // davet edenin ödülü
export const REF_FRIEND = 50;         // davet edilenin ödülü
export const VIZVIZ_MAX_MS = 12000;   // hile koruması: max süre (yedek sabit)
export const VIZVIZ_COOLDOWN_MS = 5 * 60 * 1000; // yedek sabit

// ── Oyuncu durumu ──
export function newState(now = Date.now()) {
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
    created: now,
    lastSeen: now,
  };
}

// ── Üretim hesapları ──
export function beeProd(level) {
  return ACTIVE_CFG.p1 * Math.pow(ACTIVE_CFG.pMult, level - 1);
}
export function beeCost(s) {
  return Math.floor(ACTIVE_CFG.beeBaseCost * Math.pow(ACTIVE_CFG.beeCostGrowth, s.beesOwned));
}
export function totalProd(s) {
  let t = 0;
  for (let l = 1; l <= MAX_LEVEL; l++) t += s.bees[l] * beeProd(l);
  return t * Math.pow(2, s.kovan);
}
export function capacity(s) {
  return ACTIVE_CFG.capBase * Math.pow(ACTIVE_CFG.capUpgMult, s.depo);
}
export function depoCost(s) {
  return Math.floor(ACTIVE_CFG.capUpgBase * Math.pow(ACTIVE_CFG.capUpgCostMult, s.depo));
}
export function kovanCost(s) {
  return Math.floor(ACTIVE_CFG.kovanBase * Math.pow(ACTIVE_CFG.kovanCostMult, s.kovan));
}

// ── Üretimi işle (kapasite doluysa taşan bal kaybolur → düzenli topla!) ──
export function collect(s, now = Date.now()) {
  const elapsed = Math.max(0, now - s.lastCollect);
  const cap = capacity(s);
  let gain = (totalProd(s) * elapsed) / 1000;
  if (gain > cap) gain = cap;
  if (gain > 0) {
    s.bal += gain;
    s.totalEarned += gain;
  }
  s.lastCollect = now;
  s.lastSeen = now;
  return gain;
}

// ── Arı satın al + otomatik birleştirme (2 aynı seviye → 1 üst) ──
export function buyBee(s, count = 1) {
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
export function upgrade(s, which) {
  const cost = which === 'kovan' ? kovanCost(s) : depoCost(s);
  if (s.bal < cost) return { ok: false, why: 'yetersiz_bal' };
  s.bal -= cost;
  if (which === 'kovan') s.kovan++;
  else s.depo++;
  return { ok: true, cost };
}

// ── Günlük ödül (seri sistemi) ──
export function claimDaily(s, now = Date.now()) {
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
export function dailyInfo(s, now = Date.now()) {
  if (!ACTIVE_CFG.dailyEnabled) return { available: false, streak: 0, nextReward: 0 };
  const today = Math.floor(now / 86400000);
  const lastDay = Math.floor(s.lastDaily / 86400000);
  const available = lastDay !== today;
  const streak = lastDay === today - 1 ? s.streak + 1 : 1;
  const clamped = streak > 7 ? 1 : streak;
  return { available, streak: clamped, nextReward: DAILY_REWARDS[clamped - 1] };
}

// ── VızVız mini oyunu (10 sn dokunma yarışı) ──
export function vzvzPlay(s, taps, durMs, now = Date.now()) {
  if (!ACTIVE_CFG.vzvzEnabled) return { ok: false, why: 'vzvz_kapali' };
  if (now - s.vzvzAt < ACTIVE_CFG.vzvzCooldownMs) return { ok: false, why: 'bekleme' };
  if (!Number.isInteger(taps) || taps < 0 || taps > ACTIVE_CFG.vzvzMaxTaps) return { ok: false, why: 'hile' };
  if (durMs > ACTIVE_CFG.vzvzMaxMs) return { ok: false, why: 'hile' };
  s.vzvzAt = now;
  s.vzvzCount++;
  const reward = taps * ACTIVE_CFG.vzvzTapReward;
  s.bal += reward;
  s.totalEarned += reward;
  return { ok: true, reward, taps };
}

// ── Başarılar (rozetler) ──
export const ACHIEVEMENTS = [
  { id: 'bee1',     emoji: '🐝', name: 'İlk Arı',        desc: 'İlk arını al',                    cond: (s) => s.beesOwned >= 1,                  reward: 10 },
  { id: 'bees10',   emoji: '👑', name: 'Arı Ustası',     desc: '10 arı sahibi ol',                cond: (s) => s.beesOwned >= 10,                 reward: 100 },
  { id: 'bees50',   emoji: '🏰', name: 'Arı Kralı',      desc: '50 arı sahibi ol',                cond: (s) => s.beesOwned >= 50,                 reward: 500 },
  { id: 'bees100',  emoji: '🤴', name: 'Arı İmparatoru', desc: '100 arı sahibi ol',               cond: (s) => s.beesOwned >= 100,                reward: 1500 },
  { id: 'level8',   emoji: '🌌', name: 'Bal Kaşifi',     desc: 'Seviye 8 arı üret',               cond: (s) => s.bees[8] > 0,                     reward: 800 },
  { id: 'level12',  emoji: '🐉', name: 'Efsane Kovan',   desc: 'Seviye 12 arı üret',              cond: (s) => s.bees[12] > 0,                    reward: 5000 },
  { id: 'cap10k',   emoji: '🏺', name: 'Depo Delisi',    desc: 'Depo 10.000 kapasiteye ulaş',     cond: (s) => capacity(s) >= 10000,               reward: 250 },
  { id: 'kovan5',   emoji: '🏭', name: 'Usta Kovan',     desc: 'Kovan seviye 5',                  cond: (s) => s.kovan >= 5,                      reward: 1000 },
  { id: 'mil',      emoji: '💎', name: 'Bal Milyoneri',  desc: 'Toplam 1.000.000 bal',            cond: (s) => s.totalEarned >= 1e6,               reward: 5000 },
  { id: 'streak7',  emoji: '🔥', name: '7 Gün',          desc: '7 günlük giriş serisi',           cond: (s) => s.streak >= 7,                     reward: 300 },
  { id: 'ref3',     emoji: '🎁', name: 'Davetçi',        desc: '3 arkadaş davet et',              cond: (s) => s.refs >= 3,                       reward: 300 },
  { id: 'vzvz10',   emoji: '⚡', name: 'VızVız Ustası',  desc: '10 kez VızVız oyna',              cond: (s) => s.vzvzCount >= 10,                 reward: 200 },
  { id: 'fast',     emoji: '🚀', name: 'Hız Canavarı',   desc: 'İlk gün 1.000 bal topla',         cond: (s, now) => s.totalEarned >= 1000 && now - s.created < 86400000, reward: 500 },
];

// Yeni kazanılan başarıları verir + ödüllerini verir
export function checkAchievements(s, now = Date.now()) {
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
export function giveAchievement(s, achId) {
  const a = ACHIEVEMENTS.find((x) => x.id === achId);
  if (!a) return { ok: false, why: 'rozet_yok' };
  if (s.ach.includes(achId)) return { ok: false, why: 'zaten_var' };
  s.ach.push(achId);
  s.bal += a.reward;
  s.totalEarned += a.reward;
  return { ok: true, reward: a.reward };
}

// ── Oyuncu seviyesi (kozmetik) ──
const LEVEL_THRESHOLDS = [0, 200, 1000, 5000, 20000, 100000, 500000, 2.5e6, 1e7, 5e7, 2.5e8];
const LEVEL_TITLES = ['Yavru Arı', 'Bal Toplayıcı', 'Kovan Çırağı', 'Arıcı', 'Usta Arıcı',
  'Bal Baronu', 'Kovan Lordu', 'Bal Kralı', 'Arı İmparatoru', 'Bal Efsanesi', 'Kozmik Kovan'];
export function playerLevel(s) {
  let lvl = 1;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) if (s.totalEarned >= LEVEL_THRESHOLDS[i]) lvl = i + 1;
  return { level: lvl, title: LEVEL_TITLES[Math.min(lvl, LEVEL_TITLES.length) - 1] };
}
