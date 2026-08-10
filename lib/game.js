// 🐝 Bal Vakti — oyun mantığı (saf fonksiyonlar)
// Tüm ekonomi burada; sunucu tarafı otoriteli (istemciye güvenilmez).

export const MAX_LEVEL = 12;

// ── Ekonomi parametreleri (denge ayarı buradan yapılır) ──
export const BEE_BASE_COST = 10;      // 1. seviye arı taban fiyatı
export const BEE_COST_GROWTH = 1.09;  // her arıda fiyat %9 artar
export const P1 = 0.25;               // 1. seviye arı: bal/sn
export const P_MULT = 3;              // her seviye 3x üretim
export const CAP_BASE = 500;          // başlangıç depo kapasitesi
export const CAP_UPG_MULT = 4;        // depo seviyesi başına 4x kapasite
export const CAP_UPG_BASE = 200;      // depo yükseltme taban fiyatı
export const CAP_UPG_COST_MULT = 3;
export const KOVAN_BASE = 400;        // kovan (üretim x2) taban fiyatı
export const KOVAN_COST_MULT = 4;
export const DAILY_REWARDS = [50, 100, 200, 400, 800, 1600, 3000]; // 7 günlük seri
export const REF_INVITER = 100;       // davet edenin ödülü
export const REF_FRIEND = 50;         // davet edilenin ödülü
export const VIZVIZ_TAP_REWARD = 2;   // VızVız oyunu: dokunuş başına bal
export const VIZVIZ_MAX_TAPS = 30;    // hile koruması: max dokunuş
export const VIZVIZ_MAX_MS = 12000;   // hile koruması: max süre
export const VIZVIZ_COOLDOWN_MS = 5 * 60 * 1000; // 5 dk bekleme
export const START_BAL = 25;          // yeni oyuncu başlangıç balı
export const START_FREE_BEES = 1;     // yeni oyuncuya 1 ücretsiz arı

// ── Oyuncu durumu ──
export function newState(now = Date.now()) {
  return {
    name: 'Arıcı',
    bal: START_BAL,
    totalEarned: 0,                  // ömür boyu kazanılan (sıralama/başarı için)
    beesOwned: START_FREE_BEES,      // satın alınan toplam arı (fiyat artışı için)
    bees: Array.from({ length: MAX_LEVEL + 1 }, (_, i) => (i === 1 ? START_FREE_BEES : 0)),
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
    created: now,
  };
}

// ── Üretim hesapları ──
export function beeProd(level) {
  return P1 * Math.pow(P_MULT, level - 1);
}
export function beeCost(s) {
  return Math.floor(BEE_BASE_COST * Math.pow(BEE_COST_GROWTH, s.beesOwned));
}
export function totalProd(s) {
  let t = 0;
  for (let l = 1; l <= MAX_LEVEL; l++) t += s.bees[l] * beeProd(l);
  return t * Math.pow(2, s.kovan);
}
export function capacity(s) {
  return CAP_BASE * Math.pow(CAP_UPG_MULT, s.depo);
}
export function depoCost(s) {
  return Math.floor(CAP_UPG_BASE * Math.pow(CAP_UPG_COST_MULT, s.depo));
}
export function kovanCost(s) {
  return Math.floor(KOVAN_BASE * Math.pow(KOVAN_COST_MULT, s.kovan));
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
  const today = Math.floor(now / 86400000);
  const lastDay = Math.floor(s.lastDaily / 86400000);
  const available = lastDay !== today;
  const streak = lastDay === today - 1 ? s.streak + 1 : 1;
  const clamped = streak > 7 ? 1 : streak;
  return { available, streak: clamped, nextReward: DAILY_REWARDS[clamped - 1] };
}

// ── VızVız mini oyunu (10 sn dokunma yarışı) ──
export function vzvzPlay(s, taps, durMs, now = Date.now()) {
  if (now - s.vzvzAt < VIZVIZ_COOLDOWN_MS) return { ok: false, why: 'bekleme' };
  if (!Number.isInteger(taps) || taps < 0 || taps > VIZVIZ_MAX_TAPS) return { ok: false, why: 'hile' };
  if (durMs > VIZVIZ_MAX_MS) return { ok: false, why: 'hile' };
  s.vzvzAt = now;
  s.vzvzCount++;
  const reward = taps * VIZVIZ_TAP_REWARD;
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

// ── Oyuncu seviyesi (kozmetik) ──
const LEVEL_THRESHOLDS = [0, 200, 1000, 5000, 20000, 100000, 500000, 2.5e6, 1e7, 5e7, 2.5e8];
const LEVEL_TITLES = ['Yavru Arı', 'Bal Toplayıcı', 'Kovan Çırağı', 'Arıcı', 'Usta Arıcı',
  'Bal Baronu', 'Kovan Lordu', 'Bal Kralı', 'Arı İmparatoru', 'Bal Efsanesi', 'Kozmik Kovan'];
export function playerLevel(s) {
  let lvl = 1;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) if (s.totalEarned >= LEVEL_THRESHOLDS[i]) lvl = i + 1;
  return { level: lvl, title: LEVEL_TITLES[Math.min(lvl, LEVEL_TITLES.length) - 1] };
}
