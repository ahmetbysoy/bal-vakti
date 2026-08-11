// 🐝 Bal Vakti — oyun mantığı (saf fonksiyonlar)
// Tüm ekonomi burada; sunucu tarafı otoriteli (istemciye güvenilmez).
// NOT: Ekonomi değerleri DEFAULT_CONFIG üzerinden okunur. Admin paneli
// (lib/db.js → getConfig) bu değerleri canlı olarak değiştirebilir;
// sunucu her istekte setActiveCfg(await getConfig()) çağırır.

export const MAX_LEVEL = 12;

// ── Ekonomi parametreleri (varsayılan; admin paneli canlı değiştirebilir) ──
// ⚠️ CİMRİ EKONOMİ (v4): ilerleme yavaş ve istikrarlı olmalı
export const DEFAULT_CONFIG = {
  beeBaseCost: 25,       // 1. seviye arı taban fiyatı
  beeCostGrowth: 1.18,   // her arıda fiyat %18 artar (cimri!)
  p1: 0.08,              // 1. seviye arı: bal/sn (saatte ~288 bal)
  pMult: 2.5,            // her seviye 2.5x üretim (birleştirme %25 bonus)
  capBase: 300,          // başlangıç depo kapasitesi
  capUpgMult: 3,         // depo seviyesi başına 3x kapasite
  capUpgBase: 800,       // depo yükseltme taban fiyatı
  capUpgCostMult: 4,
  kovanBase: 2500,       // kovan (üretim x2) taban fiyatı — pahalı!
  kovanCostMult: 6,
  startBal: 15,          // yeni oyuncu başlangıç balı
  startFreeBees: 1,      // yeni oyuncuya ücretsiz arı
  vzvzTapReward: 1,      // VızVız: dokunuş başına 1 bal
  vzvzMaxTaps: 20,       // VızVız max dokunuş
  vzvzMaxMs: 12000,      // VızVız hile koruması: max süre
  vzvzCooldownMs: 600000, // VızVız bekleme (10 dk!)
  dailyEnabled: true,    // günlük ödül açık/kapalı
  vzvzEnabled: true,     // VızVız açık/kapalı
  maintenance: false,    // bakım modu (oyun kapanır)
};

// Aktif konfigürasyon (her istekte db.getConfig() ile set edilir)
let ACTIVE_CFG = DEFAULT_CONFIG;
export function setActiveCfg(c) { ACTIVE_CFG = c || DEFAULT_CONFIG; }
export function getActiveCfg() { return ACTIVE_CFG; }

export const DAILY_REWARDS = [15, 30, 60, 120, 240, 500, 1000]; // 7 günlük seri (cimri)
export const REF_INVITER = 40;        // davet edenin ödülü
export const REF_FRIEND = 20;         // davet edilenin ödülü
export const VIZVIZ_MAX_MS = 12000;   // hile koruması: max süre (yedek sabit)
export const VIZVIZ_COOLDOWN_MS = 10 * 60 * 1000; // yedek sabit (config ile uyumlu)

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
export function beeProd(level) {
  return ACTIVE_CFG.p1 * Math.pow(ACTIVE_CFG.pMult, level - 1);
}
export function beeCost(s) {
  return Math.floor(ACTIVE_CFG.beeBaseCost * Math.pow(ACTIVE_CFG.beeCostGrowth, s.beesOwned));
}
// 🌙 Gece etkinliği: 22:00-06:00 arası üretim x2 (Türkiye saati)
export function isNight(now = Date.now()) {
  const h = new Date(now).getHours();
  return h >= 22 || h < 6;
}
export function prodMultiplier(now = Date.now()) {
  return isNight(now) ? 1.5 : 1; // gece bonusu kısıldı (2x -> 1.5x)
}
export function totalProd(s, now = Date.now()) {
  let t = 0;
  for (let l = 1; l <= MAX_LEVEL; l++) t += s.bees[l] * beeProd(l);
  return t * Math.pow(2, s.kovan) * effectiveMult(s, now);
}
// ⚡ Üretim çarpanı: gece x2 + çark boostu +1 (çakışırsa x3)
export function effectiveMult(s, now = Date.now()) {
  let m = prodMultiplier(now); // gece 1.5
  if ((s.boostUntil || 0) > now) m += 0.5; // çark boostu +0.5 (toplam max 2)
  return m;
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
  let gain = (totalProd(s, now) * elapsed) / 1000;
  // 🛑 CAP BUG FIX: bal zaten cap'e yakınsa gain, kalan boşluğa kesilir
  const room = Math.max(0, cap - (s.bal || 0));
  if (gain > room) gain = room;
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
  s.weeklyEarned = (s.weeklyEarned || 0) + reward;
  s.todayEarned = (s.todayEarned || 0) + reward;
  return { ok: true, reward, taps };
}

/* ═══════════════════ 🎰 EĞLENCE ODASI ═══════════════════ */

// 🎡 Çarkıfelek dilimleri
export const WHEEL_SLICES = [
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
export function spinWheel(s, now = Date.now()) {
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


// 🎲 Yazı-Tura (2x) — sunucu tarafı adil rastgele
export const GAMBLE_DAILY_LOSS_LIMIT = 500; // günlük max kayıp (cimri)
export const GAMBLE_MAX_BET_RATIO = 0.2;     // max bahis = balın %20'si
export function gambleCoin(s, bet, now = Date.now()) {
  if (!Number.isFinite(bet) || bet < 1) return { ok: false, why: 'bahis_gecersiz' };
  if (bet > s.bal * GAMBLE_MAX_BET_RATIO) return { ok: false, why: 'bahis_siniri' };
  const dayKey = Math.floor(now / 86400000);
  if ((s.gambleLostDay === dayKey && (s.gambleLost || 0) + bet > GAMBLE_DAILY_LOSS_LIMIT) || (s.gambleLostDay === dayKey && (s.gambleLost || 0) >= GAMBLE_DAILY_LOSS_LIMIT)) {
    return { ok: false, why: 'gunluk_kayip_siniri' };
  }
  if (bet > s.bal) return { ok: false, why: 'yetersiz_bal' };
  const win = Math.random() < 0.5;
  s.bal -= bet;
  let reward = 0;
  if (win) {
    reward = bet * 2;
    s.bal += reward;
    s.totalEarned += reward;
    s.weeklyEarned = (s.weeklyEarned || 0) + reward;
    s.todayEarned = (s.todayEarned || 0) + reward;
  } else {
    // günlük kayıp takibi
    if (s.gambleLostDay !== dayKey) { s.gambleLostDay = dayKey; s.gambleLost = 0; }
    s.gambleLost = (s.gambleLost || 0) + bet;
  }
  s.gambleCount = (s.gambleCount || 0) + 1;
  return { ok: true, win, reward, lost: win ? 0 : bet, result: win ? 'yazi' : 'tura' };
}

// 🎰 Slot (3 emoji; 3 aynı 3x, 2 aynı 1.5x, yoksa 0)
const SLOT_SYMBOLS = ['🍯', '🐝', '✨', '👑', '🍀'];
export function gambleSlot(s, bet, now = Date.now()) {
  if (!Number.isFinite(bet) || bet < 1) return { ok: false, why: 'bahis_gecersiz' };
  if (bet > s.bal * GAMBLE_MAX_BET_RATIO) return { ok: false, why: 'bahis_siniri' };
  const dayKey = Math.floor(now / 86400000);
  if (s.gambleLostDay === dayKey && (s.gambleLost || 0) >= GAMBLE_DAILY_LOSS_LIMIT) {
    return { ok: false, why: 'gunluk_kayip_siniri' };
  }
  if (bet > s.bal) return { ok: false, why: 'yetersiz_bal' };
  const r = () => SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)];
  const a = r(), b = r(), c = r();
  let mult = 0;
  if (a === b && b === c) mult = 3;
  else if (a === b || b === c || a === c) mult = 1.5;
  s.bal -= bet;
  let reward = 0;
  if (mult > 0) {
    reward = Math.floor(bet * mult);
    s.bal += reward;
    s.totalEarned += reward;
    s.weeklyEarned = (s.weeklyEarned || 0) + reward;
    s.todayEarned = (s.todayEarned || 0) + reward;
  } else {
    if (s.gambleLostDay !== dayKey) { s.gambleLostDay = dayKey; s.gambleLost = 0; }
    s.gambleLost = (s.gambleLost || 0) + bet;
  }
  s.gambleCount = (s.gambleCount || 0) + 1;
  return { ok: true, win: mult > 0, reward, lost: mult > 0 ? 0 : bet, symbols: [a, b, c], mult };
}

/* ═══════════════════ 🐝 ARILAR ═══════════════════ */

// Seviyeye göre arı görünümü (kozmetik)
export const BEE_EMOJIS = ['🐝', '🦋', '🦅', '🐉', '🦁', '🐯', '🦂', '🦄', '👑', '🔥', '💎', '🌌'];
export function beeEmoji(level) {
  return BEE_EMOJIS[Math.min(level - 1, BEE_EMOJIS.length - 1)];
}

/* ── Haftalık/bugünlük sayaçlar (her kazançta işlenir) ── */
export function addEarned(s, amount, now = Date.now()) {
  s.weeklyEarned = (s.weeklyEarned || 0) + amount;
  s.todayEarned = (s.todayEarned || 0) + amount;
  // hafta/bugün anahtarları (pazartesi sıfırlama)
  const wk = Math.floor(now / (7 * 86400000));
  if (s.weekKey !== wk) { s.weekKey = wk; s.weeklyEarned = amount; }
  const day = Math.floor(now / 86400000);
  if (s.dayKey !== day) { s.dayKey = day; s.todayEarned = amount; }
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

/* ═══════════════════ 💥 BAL BOMBASI (Emoji Fırlatma) ═══════════════════ */
export const THROW_EMOJI_COST = 25;
export const THROW_EMOJI_COOLDOWN_MS = 30 * 1000;
export const THROW_EMOJIS = ['💩', '🍅', '🔥', '💣', '🎉', '🐝', '🍯', '🥊', '💧', '👑'];

export function throwEmoji(s, targetId, emoji, now = Date.now()) {
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
export function playerLevel(s) {
  let lvl = 1;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) if (s.totalEarned >= LEVEL_THRESHOLDS[i]) lvl = i + 1;
  return { level: lvl, title: LEVEL_TITLES[Math.min(lvl, LEVEL_TITLES.length) - 1] };
}

/* ═══════════════════ ⚔️ BAL BASKINI (PvP) ═══════════════════ */

// ── Savaşçı (XP) seviyesi: seviye N için 50×N XP ──
export const WAR_XP_PER_LEVEL = 50;
export function warLevel(xp) {
  const level = Math.max(1, Math.floor(xp / WAR_XP_PER_LEVEL) + 1);
  return { level, xp, into: xp % WAR_XP_PER_LEVEL, need: WAR_XP_PER_LEVEL };
}

// ── Saldırı gücü ──
export function raidPower(s) {
  const wl = warLevel(s.xp || 0).level;
  return (totalProd(s) * 10) + (wl * 50) + (s.beesOwned * 5) + (s.kovan * 200);
}

// Arıları en düşük seviyeden sil (n adet); 0'ın altına inmez, hiç arı kalmazsa 1 ücretsiz verilir
export function killBees(s, n) {
  if (!Number.isInteger(n) || n <= 0) return 0;
  let left = n;
  for (let l = 1; l <= MAX_LEVEL && left > 0; l++) {
    const kill = Math.min(s.bees[l], left);
    s.bees[l] -= kill;
    s.beesOwned -= kill;
    left -= kill;
  }
  if (s.beesOwned < 1) {
    s.bees[1] = 1;
    s.beesOwned = 1;
  }
  return n - left; // gerçekte ölen arı sayısı
}

// Savunma geliri eşiği: aşılırsa bir sonraki başarılı saldırıda arı ölümü tetiklenir
export const DEFENSE_BAL_THRESHOLD = 800;

// ── Savaş çözümü ──
// A: saldırgan, T: hedef, defendActive: hedef 'Püskürt'e bastı mı (çevrimiçi savunma)
// Döner: { winner: 'A'|'T'|'draw', xpA, xpT, stolen, beesKilled, defenseGain, ratio, koalisyon }
export function resolveRaid(A, T, defendActive, now = Date.now()) {
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
export function mutualRaidPenalty(A, T, now = Date.now()) {
  const wA = warLevel(A.xp || 0).level;
  const wT = warLevel(T.xp || 0).level;
  const penalty = 10;
  A.xp = Math.max(0, (A.xp || 0) - penalty);
  T.xp = Math.max(0, (T.xp || 0) - penalty);
  return { penalty, wA, wT };
}

// Koalisyon: aynı hedefe son 10 dk içinde 2+ farklı saldırgan varsa +5 XP
export function coalitionBonus(attacker, count) {
  if (count >= 2) {
    attacker.xp = (attacker.xp || 0) + 5;
    return 5;
  }
  return 0;
}
