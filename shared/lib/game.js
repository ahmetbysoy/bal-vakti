// 🐝 Bal Vakti — oyun mantığı (saf fonksiyonlar)
// Tüm ekonomi burada; sunucu tarafı otoriteli (istemciye güvenilmez).
// NOT: Ekonomi değerleri DEFAULT_CONFIG üzerinden okunur. Admin paneli
// (lib/db.js → getConfig) bu değerleri canlı olarak değiştirebilir;
// sunucu her istekte setActiveCfg(await getConfig()) çağırır.

export const MAX_LEVEL = 10; // 2^9=512 arı ile seviye 10 — çocuklar için ulaşılabilir

// ── Ekonomi parametreleri (varsayılan; admin paneli canlı değiştirebilir) ──
// ⚠️ CİMRİ EKONOMİ (v4): ilerleme yavaş ve istikrarlı olmalı
export const DEFAULT_CONFIG = {
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
export function setActiveCfg(c) { ACTIVE_CFG = c || DEFAULT_CONFIG; }
export function getActiveCfg() { return ACTIVE_CFG; }

export const DAILY_REWARDS = [25, 50, 100, 200, 400, 800, 1500]; // 7 günlük seri
export const REF_INVITER = 40;        // davet edenin ödülü
export const REF_FRIEND = 20;         // davet edilenin ödülü
export const VIZVIZ_MAX_MS = 12000;   // hile koruması: max süre (yedek sabit)
export const VIZVIZ_COOLDOWN_MS = 2 * 60 * 1000; // yedek sabit (config ile uyumlu)

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
export function beeProd(level) {
  return ACTIVE_CFG.p1 * Math.pow(ACTIVE_CFG.pMult, level - 1);
}
export function beeCost(s) {
  return Math.floor(ACTIVE_CFG.beeBaseCost * Math.pow(ACTIVE_CFG.beeCostGrowth, s.beesOwned));
}
// 🌙 Gece etkinliği: 22:00-06:00 arası üretim x2 (Türkiye saati)
export function isNight(now = Date.now()) {
  // 🇹🇷 Türkiye saati: UTC+3 (2016'dan beri sabit, yaz/kış farkı yok)
  const h = (new Date(now).getUTCHours() + 3) % 24;
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
  if ((s.boostUntil || 0) > now) m += 0.5; // çark boostu +0.5
  if ((s.streakBoostUntil || 0) > now) m += 1; // toplama streak +1 (altın kovan x3)
  if ((s.warBoostUntil || 0) > now) m += 1; // savaşçı modu +1
  if (rainbowActive(s, now)) m += 1; // 🌈 gökkuşağı +1 (geceyle x3!)
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
// 🎯 DOP-2: Toplama Streak — 60 sn içinde art arda Topla
// 3 → üretim x1.2 (30sn) · 5 → x1.5 (60sn) · 10 → ALTIN KOVAN x3 (30sn)
export function collectStreakMult(streak) {
  if (streak >= 10) return 3;
  if (streak >= 5) return 1.5;
  if (streak >= 3) return 1.2;
  return 1;
}
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
// 🎯 DOP-1: VızVız COMBO — 5+ dokunuş x2, 10+ x3, 20+ BAL FRENZİ x5
export function vzvzComboMult(taps) {
  if (taps >= 20) return 5;
  if (taps >= 10) return 3;
  if (taps >= 5) return 2;
  return 1;
}
export function vzvzPlay(s, taps, durMs, now = Date.now()) {
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


/* ═══════════════════ 🎁 GÜNLÜK SANDIK (kumar yerine — çocuk dostu) ═══════════════════ */
export const CHEST_REWARDS = [10, 25, 50, 100, 250, 500];
export const CHEST_JACKPOT = 1000;
export const CHEST_JACKPOT_CHANCE = 0.05;
export const CHEST_EXTRA_COST = 100; // 2. kart

// Günde 1 bedava + 100 bal ile 2. kart (3 karttan 1'ini seç)
export function openChest(s, cardIndex, now = Date.now()) {
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
export function chestInfo(s, now = Date.now()) {
  const day = Math.floor(now / 86400000);
  const used = s.chestDay === day ? (s.chestUses || 0) : 0;
  return { freeLeft: used < 1 ? 1 : 0, paidLeft: used < 2 ? 1 : 0, used };
}

/* ═══════════════════ 🐝 ARILAR ═══════════════════ */

// Seviyeye göre arı görünümü (kozmetik)
export const BEE_EMOJIS = ['🐝', '🦋', '🦅', '🐉', '🦁', '🐯', '🦂', '🦄', '👑', '🔥'];
export function beeEmoji(level) {
  return BEE_EMOJIS[Math.min(level - 1, BEE_EMOJIS.length - 1)];
}

/* ── Haftalık/bugünlük sayaçlar (her kazançta işlenir) ── */
export function addEarned(s, amount, now = Date.now()) {
  // 🐛 FIX: önce hafta/gün anahtarı kontrolü (çift sayım yok)
  const wk = Math.floor(now / (7 * 86400000));
  if (s.weekKey !== wk) { s.weekKey = wk; s.weeklyEarned = 0; }
  const day = Math.floor(now / 86400000);
  if (s.dayKey !== day) { s.dayKey = day; s.todayEarned = 0; }
  s.weeklyEarned = (s.weeklyEarned || 0) + amount;
  s.todayEarned = (s.todayEarned || 0) + amount;
}

// ── Başarılar (rozetler) ──
export const ACHIEVEMENTS = [
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
export function checkAchievements(s, now = Date.now()) {
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
export const THROW_EMOJIS = ['🍅', '🔥', '💣', '🎉', '🐝', '🍯', '🥊', '💧', '👑', '🎈'];

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

/* ═══════════════════ 📋 GÜNLÜK GÖREVLER ═══════════════════ */
export const DAILY_QUESTS = [
  { id: 'buy',   emoji: '🐝', name: 'Arı Avcısı',   desc: '3 arı satın al',      target: 3, reward: 40 },
  { id: 'collect', emoji: '🍯', name: 'Bal Toplayıcı', desc: '5 kez bal topla',   target: 5, reward: 40 },
  { id: 'vzvz',  emoji: '⚡', name: 'VızVız Ustası', desc: '1 kez VızVız oyna',   target: 1, reward: 50 },
  { id: 'raid',  emoji: '⚔️', name: 'Savaşçı',      desc: '1 savaşa katıl',      target: 1, reward: 60 },
  { id: 'spin',  emoji: '🎡', name: 'Çarkçı',        desc: '1 çark çevir',        target: 1, reward: 30 },
];
export const QUEST_ALL_BONUS = 100; // hepsini bitir → bonus

export function questState(s, now = Date.now()) {
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
export function questProgress(s, id, amount = 1, now = Date.now()) {
  questState(s, now);
  if (!(id in s.questProg)) return { ok: false };
  s.questProg[id] = Math.min(s.questProg[id] + amount, 99);
  return { ok: true, prog: s.questProg, claimed: s.questClaimed || [] };
}
export function questClaim(s, id, now = Date.now()) {
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
export function questInfo(s, now = Date.now()) {
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
export function balloonReward(score) {
  if (score >= 50) return 200;
  if (score >= 40) return 100;
  if (score >= 30) return 60;
  if (score >= 20) return 35;
  if (score >= 10) return 15;
  return 5;
}
export function balloonComboMult(combo) {
  if (combo >= 20) return 5;  // BAL FRENZİ
  if (combo >= 10) return 3;
  if (combo >= 5) return 2;
  return 1;
}
export function playBalloon(s, score, now = Date.now()) {
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
export function timerReward(diff) {
  if (diff <= 0.05) return 100;  // MÜKEMMEL
  if (diff <= 0.10) return 60;   // Harika
  if (diff <= 0.20) return 30;   // İyi
  return 10;                      // Bir daha dene
}
export function playTimer(s, stoppedAt, target, now = Date.now()) {
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
export const RAINBOW_CHANCE = 0.05; // %5/gün
export const RAINBOW_DURATION_MS = 10 * 60 * 1000; // 10 dk

// Gökkuşağı: oyuna girişte %5 şans, üretim x2 10 dk
export function rollRainbow(s, now = Date.now()) {
  const day = Math.floor(now / 86400000);
  if (s.rainbowDay === day) return null; // günde 1 kez
  if (Math.random() >= RAINBOW_CHANCE) return null;
  s.rainbowDay = day;
  s.rainbowUntil = now + RAINBOW_DURATION_MS;
  return { until: s.rainbowUntil, durationMs: RAINBOW_DURATION_MS };
}
export function rainbowActive(s, now = Date.now()) {
  return (s.rainbowUntil || 0) > now;
}

/* ═══════════════════ 🐝 LABİRENT MİNİ OYUNU ═══════════════════ */
export const MAZE_LEVELS = [
  { lvl: 1, size: 5, flowers: 3, timeSec: 60, base: 20, flowerBonus: 5,  next: 2 },
  { lvl: 2, size: 6, flowers: 4, timeSec: 55, base: 40, flowerBonus: 8,  next: 3 },
  { lvl: 3, size: 7, flowers: 5, timeSec: 50, base: 70, flowerBonus: 12, next: null },
];
export const MAZE_DAILY_PLAYS = 3;
export function playMaze(s, level, flowers, won, now = Date.now()) {
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
export const CIRCUS_CHANCE = 0.03;
export const CIRCUS_DURATION_MS = 24 * 3600 * 1000; // 24 saat
export function rollCircus(s, now = Date.now()) {
  const day = Math.floor(now / 86400000);
  if (s.circusDay === day) return null;
  if (Math.random() >= CIRCUS_CHANCE) return null;
  s.circusDay = day;
  s.circusUntil = now + CIRCUS_DURATION_MS;
  return { until: s.circusUntil };
}
export function circusActive(s, now = Date.now()) {
  return (s.circusUntil || 0) > now;
}

/* ═══════════════════ 👽 UZAYLI + YILDIZ TOZU + MARKET ═══════════════════ */
export const ALIEN_CHANCE = 0.01;
export const ALIEN_GIFT_STARDUST = 50;
export function rollAlien(s, now = Date.now()) {
  const day = Math.floor(now / 86400000);
  if (s.alienDay === day) return null;
  if (Math.random() >= ALIEN_CHANCE) return null;
  s.alienDay = day;
  s.stardust = (s.stardust || 0) + ALIEN_GIFT_STARDUST;
  return { stardust: s.stardust, gift: ALIEN_GIFT_STARDUST };
}
export const MARKET_ITEMS = [
  { id: 'crown',   name: 'Altın Taç',  emoji: '👑', price: 300, desc: 'Profilde taç gösterir' },
  { id: 'glow',    name: 'Parlayan Arı', emoji: '✨', price: 500, desc: 'Arıların parıldar' },
  { id: 'rainbow', name: 'Gökkuşağı Kovan', emoji: '🌈', price: 800, desc: 'Kovan renk değiştirir' },
];
export function buyCosmetic(s, id, now = Date.now()) {
  const item = MARKET_ITEMS.find((i) => i.id === id);
  if (!item) return { ok: false, why: 'urun_yok' };
  if ((s.stardust || 0) < item.price) return { ok: false, why: 'toz_yok' };
  if ((s.cosmetics || []).includes(id)) return { ok: false, why: 'zaten_var' };
  s.stardust -= item.price;
  if (!Array.isArray(s.cosmetics)) s.cosmetics = [];
  s.cosmetics.push(id);
  return { ok: true, item, stardust: s.stardust };
}
