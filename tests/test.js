// 🧪 Bal Vakti — oyun mantığı testleri
// Çalıştır: npm test
import assert from 'assert';
import {
  newState, collect, buyBee, upgrade, claimDaily, dailyInfo, vzvzPlay,
  checkAchievements, playerLevel, capacity, totalProd, beeCost, beeProd,
  ACHIEVEMENTS, VIZVIZ_COOLDOWN_MS, MAX_LEVEL, setActiveCfg, DEFAULT_CONFIG, giveAchievement,
  warLevel, raidPower, resolveRaid, mutualRaidPenalty, coalitionBonus, killBees,
  isNight, prodMultiplier, spinWheel, openChest, CHEST_REWARDS, CHEST_JACKPOT, WHEEL_SLICES,
  vzvzComboMult, collectStreakMult, beeEmoji, addEarned,
  questProgress, questClaim, questInfo, DAILY_QUESTS,
  throwEmoji, THROW_EMOJI_COST, THROW_EMOJI_COOLDOWN_MS,
} from '../shared/lib/game.js';
import { PERSONALITIES, makeBotState, randName, NAME_POOL, createBot, thinkBots } from '../shared/lib/brain.js';
import { getUser, deleteBot } from '../shared/lib/db.js';

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  ✅', name); }
  catch (e) { failed++; console.log('  ❌', name, '—', e.message); }
}
function near(a, b, eps = 1e-6) { assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`); }

console.log('🧪 Bal Vakti testleri başlıyor...\n');

// Testlerin tutarlılığı için sabit GÜNDÜZ zamanı (gece bonusu testleri karıştırmasın)
const now0 = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); })();
const NIGHT_TS = (() => { const d = new Date(); d.setHours(23, 30, 0, 0); return d.getTime(); })();

// 1) Yeni oyuncu
t('Yeni oyuncu 20 bal + 1 arı ile başlar', () => {
  const s = newState(now0);
  assert.strictEqual(s.bal, 20);
  assert.strictEqual(s.bees[1], 1);
  assert.strictEqual(s.beesOwned, 1);
});

// 2) Üretim işleme
t('1 seviye arı 10 sn de 1.2 bal üretir', () => {
  const s = newState(now0);
  const r = collect(s, now0 + 10000);
  near(r.gain, 1.2);
  near(s.bal, 21.2); // startBal 20
});

// 3) Kapasite sınırı (taşan bal kaybolur)
t('Üretim kapasiteyi aşamaz', () => {
  const s = newState(now0);
  s.bal = 0; s.lastCollect = now0;
  s.bees = Array.from({ length: MAX_LEVEL + 1 }, () => 0);
  s.bees[MAX_LEVEL] = 1; // 177147 bal/sn
  const r = collect(s, now0 + 60000);
  assert.ok(r.gain <= capacity(s));
  assert.ok(s.bal <= capacity(s));
});

// 4) Arı satın alma + otomatik birleştirme
t('2 arı alınca 1 seviye-2 arı oluşur (otomatik birleştirme)', () => {
  const s = newState(now0); // 1 ücretsiz L1 ile başlar
  s.bal = 1000;
  buyBee(s, 1); // 2 L1 -> anında 1 L2
  assert.strictEqual(s.bees[1], 0);
  assert.strictEqual(s.bees[2], 1);
  buyBee(s, 1); // +1 L1 -> 1 L2 + 1 L1
  assert.strictEqual(s.bees[1], 1);
  assert.strictEqual(s.bees[2], 1);
});

// 5) Birleştirme zinciri (kaskad)
t('4 arı alınca 1 seviye-3 arı oluşur', () => {
  const s = newState(now0);
  s.bal = 10000;
  buyBee(s, 1); buyBee(s, 1); buyBee(s, 1); // 1+3 = 4 L1
  assert.strictEqual(s.bees[3], 1); // 4 L1 -> 2 L2 -> 1 L3
});

// 6) Arı fiyatı arttıkça pahalılaşır
t('Arı fiyatı her arıda artar', () => {
  const s = newState(now0);
  s.bal = 10000;
  const c1 = beeCost(s);
  buyBee(s, 1);
  assert.ok(beeCost(s) > c1);
});

// 7) Kovan yükseltme üretimi 2x yapar
t('Kovan yükseltme üretimi 2 katına çıkarır', () => {
  const s = newState(now0);
  const before = totalProd(s);
  s.bal = 1e9;
  upgrade(s, 'kovan');
  near(totalProd(s), before * 2);
});

// 8) Yetersiz balda satın alma reddedilir
t('Yetersiz balda arı alınamaz', () => {
  const s = newState(now0);
  s.bal = 1;
  const r = buyBee(s, 1);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(s.beesOwned, 1);
});

// 9) Günlük ödül serisi
t('Günlük seri 1,2,3... şeklinde ilerler', () => {
  const s = newState(now0);
  const day = 86400000;
  const r1 = claimDaily(s, now0 + day);
  assert.strictEqual(r1.streak, 1);
  assert.strictEqual(r1.reward, 25);
  const r2 = claimDaily(s, now0 + day * 2);
  assert.strictEqual(r2.streak, 2);
  assert.strictEqual(r2.reward, 50);
  // aynı gün tekrar alamaz
  const again = claimDaily(s, now0 + day * 2 + 1000);
  assert.strictEqual(again, null);
  // gün atlarsa seri sıfırlanır
  const r4 = claimDaily(s, now0 + day * 10);
  assert.strictEqual(r4.streak, 1);
});

// 10) dailyInfo
t('dailyInfo günlük ödül uygunluğunu söyler', () => {
  const s = newState(now0);
  const d = dailyInfo(s, now0 + 86400000);
  assert.strictEqual(d.available, true);
  const d2 = dailyInfo(s, now0);
  assert.strictEqual(d2.available, true); // henüz almadı
});

// 11) VızVız
t('VızVız dokunuş başına 2 bal verir, 2 dk bekleme koyar', () => {
  const s = newState(now0);
  const r = vzvzPlay(s, 20, 9500, now0);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reward, 200); // 20 x 2 x 5 FRENZI
  const r2 = vzvzPlay(s, 5, 1000, now0 + 1000);
  assert.strictEqual(r2.ok, false); // bekleme süresi
  const r3 = vzvzPlay(s, 5, 1000, now0 + VIZVIZ_COOLDOWN_MS + 1);
  assert.strictEqual(r3.ok, true);
  // hile koruması
  const r4 = vzvzPlay(s, 999, 1000, now0 + VIZVIZ_COOLDOWN_MS * 2);
  assert.strictEqual(r4.ok, false);
});

// 12) Başarılar
t('Milyon bal toplayınca Bal Milyoneri rozeti gelir', () => {
  const s = newState(now0);
  s.totalEarned = 1_000_000;
  const fresh = checkAchievements(s, now0);
  assert.ok(fresh.some((a) => a.id === 'mil'));
  assert.ok(s.ach.includes('mil'));
  assert.ok(s.bal >= 25 + 5000); // ödül hesaba eklendi
});

t('Hız Canavarı sadece ilk gün kazanılır', () => {
  const s = newState(now0);
  s.totalEarned = 2000;
  const fresh = checkAchievements(s, now0 + 2 * 86400000); // 2. gün
  assert.ok(!fresh.some((a) => a.id === 'fast'));
  const s2 = newState(now0);
  s2.totalEarned = 2000;
  const fresh2 = checkAchievements(s2, now0 + 3600000);
  assert.ok(fresh2.some((a) => a.id === 'fast'));
});

// 13) Oyuncu seviyesi
t('Oyuncu seviyesi toplam bala göre artar', () => {
  const s = newState(now0);
  assert.strictEqual(playerLevel(s).level, 1);
  s.totalEarned = 5000;
  assert.strictEqual(playerLevel(s).level, 4);
});

// 14) Başarı tanımları tutarlı
t('Tüm başarı idleri benzersiz', () => {
  const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
  assert.strictEqual(ids.size, ACHIEVEMENTS.length);
});

// 15) Canlı konfigürasyon override (admin paneli)
t('Konfigürasyon override ekonomiyi değiştirir', () => {
  setActiveCfg({ ...DEFAULT_CONFIG, p1: 1, beeBaseCost: 99 });
  const s = newState(now0); // 1 ücretsiz arı ile başlar
  near(beeProd(1), 1);
  assert.strictEqual(beeCost(s), Math.floor(99 * Math.pow(1.15, 1))); // 113
  setActiveCfg(DEFAULT_CONFIG); // geri al
  near(beeProd(1), 0.12);
});

t('Günlük ödül kapatılınca claimDaily null döner', () => {
  setActiveCfg({ ...DEFAULT_CONFIG, dailyEnabled: false });
  const s = newState(now0);
  assert.strictEqual(claimDaily(s, now0 + 86400000), null);
  assert.strictEqual(dailyInfo(s, now0).available, false);
  setActiveCfg(DEFAULT_CONFIG);
  assert.strictEqual(claimDaily(s, now0 + 86400000).reward, 25);
});

t('VızVız kapatılınca oynanamaz', () => {
  setActiveCfg({ ...DEFAULT_CONFIG, vzvzEnabled: false });
  const s = newState(now0);
  const r = vzvzPlay(s, 5, 1000, now0);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.why, 'vzvz_kapali');
  setActiveCfg(DEFAULT_CONFIG);
});

t('giveAchievement rozet verir ve tekrar vermez', () => {
  const s = newState(now0);
  const r1 = giveAchievement(s, 'mil');
  assert.strictEqual(r1.ok, true);
  const r2 = giveAchievement(s, 'mil');
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(r2.why, 'zaten_var');
});

// ── ⚔️ PvP testleri ──
t('warLevel XP gore seviye verir', () => {
  assert.strictEqual(warLevel(0).level, 1);
  assert.strictEqual(warLevel(49).level, 1);
  assert.strictEqual(warLevel(50).level, 2);
  assert.strictEqual(warLevel(125).level, 3);
  assert.strictEqual(warLevel(125).into, 25);
});

t('Güçlü saldırgan zayıf hedefi yener (XP + bal çalma + arı hasarı)', () => {
  const A = newState(now0), T = newState(now0);
  A.bal = 1e9; A.beesOwned = 100; A.bees = Array.from({ length: MAX_LEVEL + 1 }, () => 0);
  A.bees[10] = 50; A.beesOwned = 50; A.xp = 500; // savaşçı sv 11
  T.bal = 10000; T.beesOwned = 5;
  const r = resolveRaid(A, T, false, now0);
  assert.strictEqual(r.winner, 'A');
  assert.ok(r.xpA > 0);
  assert.ok(r.stolen > 0);
  assert.ok(r.beesKilled > 0);
  assert.strictEqual(T.beesOwned + r.beesKilled, 5); // arılar silindi
  assert.strictEqual(A.raidWins, 1);
  assert.ok(T.defenseBal > 0); // savunma geliri
});

t('Zayıf saldırgan püskürtülür (XP cezası)', () => {
  const A = newState(now0), T = newState(now0);
  A.beesOwned = 1; A.xp = 0;
  T.bal = 1e9; T.beesOwned = 100; T.bees = Array.from({ length: MAX_LEVEL + 1 }, () => 0);
  T.bees[12] = 100; T.beesOwned = 100; T.xp = 1000; T.kovan = 5;
  const r = resolveRaid(A, T, true, now0); // aktif savunma
  assert.strictEqual(r.winner, 'T');
  assert.ok(r.xpT > 0);
  assert.strictEqual(A.xp, 0); // 15 ceza → 0'a çakılır
  assert.strictEqual(T.defended, 1);
});

t('Savunma geliri eşiği aşılınca arı ölür (🩸)', () => {
  const A = newState(now0), T = newState(now0);
  A.bal = 1e9; A.beesOwned = 100; A.bees = Array.from({ length: MAX_LEVEL + 1 }, () => 0);
  A.bees[10] = 50; A.beesOwned = 50; A.xp = 500;
  T.bal = 50000; T.beesOwned = 10;
  T.defenseBal = 1999; // eşiğe yakın
  const r1 = resolveRaid(A, T, false, now0);
  assert.ok(r1.beesKilled >= 1);
  // defenseBal 1999 + sigorta → eşiği geçer → +1 arı ölümü tetiklenmeli
  const A2 = newState(now0), T2 = newState(now0);
  A2.bal = 1e9; A2.beesOwned = 100; A2.bees = Array.from({ length: MAX_LEVEL + 1 }, () => 0);
  A2.bees[10] = 50; A2.beesOwned = 50; A2.xp = 500;
  T2.bal = 50000; T2.beesOwned = 10;
  T2.defenseBal = 2000; // eşik aşıldı
  const r2 = resolveRaid(A2, T2, false, now0);
  assert.strictEqual(T2.defenseBal, 0); // eşik sıfırlandı
});

t('killBees oranlı siler, 0 arı kalmaz', () => {
  const s = newState(now0);
  s.beesOwned = 1;
  const killed = killBees(s, 5);
  assert.ok(s.beesOwned >= 1); // asla 0 olmaz
  assert.strictEqual(s.bees[1], 1);
  // Oranlı: 4 arıdan 2'si silinmeli (oran 0.5)
  const s2 = newState(now0);
  s2.beesOwned = 4; s2.bees[1] = 4;
  const k2 = killBees(s2, 2);
  assert.ok(k2 >= 2);
  assert.strictEqual(s2.beesOwned, 2);
});

t('mutualRaidPenalty iki tarafa da ceza verir', () => {
  const A = newState(now0), T = newState(now0);
  A.xp = 100; T.xp = 100;
  const r = mutualRaidPenalty(A, T, now0);
  assert.strictEqual(r.penalty, 10);
  assert.strictEqual(A.xp, 90);
  assert.strictEqual(T.xp, 90);
});

t('coalitionBonus 2+ saldırganda +5 XP verir', () => {
  const A = newState(now0);
  assert.strictEqual(coalitionBonus(A, 1), 0);
  assert.strictEqual(coalitionBonus(A, 2), 5);
  assert.strictEqual(A.xp, 5);
});

t('raidPower arılar/üretim/kovan ile artar', () => {
  const s = newState(now0);
  const p1 = raidPower(s);
  s.beesOwned = 10; s.bees[1] = 10; s.kovan = 2;
  assert.ok(raidPower(s) > p1);
});

// ── 🤖 Bot (NPC) testleri ──
t('Kişilik profilleri tanımlı ve 0-100 aralığında', () => {
  for (const key of Object.keys(PERSONALITIES)) {
    const p = PERSONALITIES[key];
    assert.ok(p.label && p.ai, key);
    for (const k of ['aggr', 'strat', 'venge', 'pack']) {
      assert.ok(p.ai[k] >= 0 && p.ai[k] <= 100, `${key}.${k}`);
    }
  }
});

t('makeBotState güç seviyesine göre arı/bal üretir', () => {
  const z = makeBotState('zayif');
  assert.ok(z.beesOwned >= 2 && z.beesOwned <= 5);
  assert.ok(z.bal >= 50);
  const e = makeBotState('efsane');
  assert.ok(e.beesOwned >= 40);
  assert.ok(e.bal >= 20000);
  assert.ok(e.kovan >= 4);
});

t('randName havuzdan isim verir, tekrarlamaz', () => {
  const n1 = randName([]);
  const n2 = randName([{ name: n1 }]);
  assert.ok(n1 !== n2);
  assert.ok(NAME_POOL.includes(n1));
});

t('createBot oyuncu durumu + meta üretir', async () => {
  const bot = await createBot({ personality: 'grudge', powerLevel: 'guclu' });
  assert.ok(bot.id.startsWith('bot_'));
  assert.ok(bot.name);
  assert.strictEqual(bot.personality, 'grudge');
  assert.ok(bot.intervalMs > 0);
  const st = await getUser(bot.id);
  assert.ok(st);
  assert.ok(st.beesOwned > 0);
  assert.strictEqual(st.name, bot.name);
  await deleteBot(bot.id);
  assert.strictEqual(await getUser(bot.id), null);
});

t('thinkBots kilitle çalışır, bot sayısı döner', async () => {
  const r1 = await thinkBots();
  assert.ok(r1.ran === true || r1.ran === false); // kilit ya da tur
  const r2 = await thinkBots({ force: true });
  assert.ok(r2.ran === true);
  assert.ok(r2.bots >= 0);
});

// ── 🎰 Eğlence Odası testleri ──
t('Gece etkinliği 22-06 arası x1.5 üretim (Türkiye saati)', () => {
  // UTC saat 20:00 = TR 23:00 → gece
  const nightTR = new Date(Date.UTC(2026, 0, 1, 20)).getTime();
  // UTC saat 12:00 = TR 15:00 → gündüz
  const dayTR = new Date(Date.UTC(2026, 0, 1, 12)).getTime();
  assert.strictEqual(isNight(nightTR), true);
  assert.strictEqual(isNight(dayTR), false);
  assert.strictEqual(prodMultiplier(dayTR), 1);
  assert.strictEqual(prodMultiplier(nightTR), 1.5);
});

t('Çarkıfelek günde 1 kez çevrilebilir', () => {
  const s = newState(now0);
  const r1 = spinWheel(s, now0);
  assert.strictEqual(r1.ok, true);
  assert.ok(WHEEL_SLICES.some((x) => x.label === r1.slice.label));
  const r2 = spinWheel(s, now0 + 1000); // aynı gün
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(r2.why, 'bugun_cirildi');
  const r3 = spinWheel(s, now0 + 86400000); // ertesi gün
  assert.strictEqual(r3.ok, true);
});

t('Çark boost 5 dk üretim x2 verir', () => {
  const s = newState(now0);
  s.lastSpin = 0;
  s.boostUntil = 0;
  // gündüz + boost = x2 (boost yokken x1)
  s.boostUntil = now0 + 5 * 60 * 1000;
  const t1 = totalProd(s, now0);
  s.boostUntil = 0;
  const t2 = totalProd(s, now0);
  assert.ok(t1 > t2);
});

// ── 🎁 Günlük Sandık (kumar yerine) ──
t('Günlük Sandık: günde 1 bedava + 2. kart 100 bal', () => {
  const s = newState(now0);
  s.bal = 500;
  const r1 = openChest(s, 0, now0);
  assert.strictEqual(r1.ok, true);
  assert.ok(CHEST_REWARDS.includes(r1.reward) || r1.reward === CHEST_JACKPOT);
  assert.strictEqual(s.chestUses, 1);
  // 2. kart ücretli
  const r2 = openChest(s, 1, now0);
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(s.chestUses, 2);
  // 3. hak yok
  const r3 = openChest(s, 2, now0);
  assert.strictEqual(r3.ok, false);
  assert.strictEqual(r3.why, 'hak_yok');
  // ertesi gün tekrar
  const r4 = openChest(s, 0, now0 + 86400000);
  assert.strictEqual(r4.ok, true);
});

t('Günlük Sandık: 100 baldan azsa 2. kart alınamaz', () => {
  const s = newState(now0);
  s.bal = 50;
  const r1 = openChest(s, 0, now0);
  assert.strictEqual(r1.ok, true);
  s.bal = 50; // rastgele ödülü sıfırla — deterministik
  const r2 = openChest(s, 1, now0);
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(r2.why, 'yetersiz_bal');
});

// ── ⚡ DOP-1: VızVız Combo ──
t('VızVız combo: 5+ x2, 10+ x3, 20+ x5 (FRENZİ)', () => {
  assert.strictEqual(vzvzComboMult(3), 1);
  assert.strictEqual(vzvzComboMult(5), 2);
  assert.strictEqual(vzvzComboMult(12), 3);
  assert.strictEqual(vzvzComboMult(20), 5);
  const s = newState(now0);
  s.bal = 100;
  const r = vzvzPlay(s, 20, 9500, now0);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.mult, 5);
  assert.strictEqual(r.frenzy, true);
  assert.strictEqual(r.reward, 20 * 2 * 5); // 20 dokunuş x 2 bal x 5
});

// ── 🔥 DOP-2: Toplama Streak ──
t('Toplama streak: 3+ x1.2, 5+ x1.5, 10+ x3', () => {
  assert.strictEqual(collectStreakMult(2), 1);
  assert.strictEqual(collectStreakMult(3), 1.2);
  assert.strictEqual(collectStreakMult(5), 1.5);
  assert.strictEqual(collectStreakMult(10), 3);
});

t('beeEmoji seviyeye göre değişir', () => {
  assert.strictEqual(beeEmoji(1), '🐝');
  assert.strictEqual(beeEmoji(4), '🐉');
  assert.ok(beeEmoji(12).length > 0);
});

t('addEarned haftalık ve günlük sayaçları işler', () => {
  const s = newState(now0);
  addEarned(s, 100, now0);
  assert.strictEqual(s.todayEarned, 100);
  assert.strictEqual(s.weeklyEarned, 100);
  addEarned(s, 50, now0 + 3600000);
  assert.strictEqual(s.todayEarned, 150);
  assert.strictEqual(s.weeklyEarned, 150);
  // 🐛 FIX: yeni günde çift sayım yok
  addEarned(s, 30, now0 + 86400000);
  assert.strictEqual(s.todayEarned, 30);
});

// ── 💥 Bal Bombası (Emoji Fırlatma) testleri ──
t('throwEmoji 25 bal maliyet + 30 sn soğuma', () => {
  const s = newState(now0);
  s.bal = 100;
  const r1 = throwEmoji(s, 'hedef1', '🔥', now0);
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(s.bal, 100 - THROW_EMOJI_COST);
  assert.strictEqual(s.thrownCount, 1);
  // soğuma
  const r2 = throwEmoji(s, 'hedef2', '🍅', now0 + 1000);
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(r2.why, 'bekleme');
  // soğuma bitti
  const r3 = throwEmoji(s, 'hedef2', '🍅', now0 + THROW_EMOJI_COOLDOWN_MS + 1);
  assert.strictEqual(r3.ok, true);
});

t('throwEmoji geçersiz emoji reddedilir', () => {
  const s = newState(now0);
  s.bal = 100;
  const r = throwEmoji(s, 'hedef', '❓', now0);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.why, 'emoji_gecersiz');
});

t('throwEmoji yetersiz balda reddedilir', () => {
  const s = newState(now0);
  s.bal = 5;
  const r = throwEmoji(s, 'hedef', '🔥', now0);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.why, 'yetersiz_bal');
});

console.log(`\n📊 Sonuç: ${passed} geçti, ${failed} kaldı`);
process.exit(failed > 0 ? 1 : 0);

// ── 📋 Günlük Görevler ──
t('Günlük görevler: progress + claim + bonus', () => {
  const s = newState(now0);
  // buy görevi: 3 arı
  questProgress(s, 'buy', 1, now0);
  questProgress(s, 'buy', 1, now0);
  questProgress(s, 'buy', 1, now0);
  const info = questInfo(s, now0);
  const buy = info.find((q) => q.id === 'buy');
  assert.strictEqual(buy.prog, 3);
  assert.strictEqual(buy.done, true);
  // claim
  const c1 = questClaim(s, 'buy', now0);
  assert.strictEqual(c1.ok, true);
  assert.strictEqual(c1.reward, 40);
  // tekrar claim yok
  const c2 = questClaim(s, 'buy', now0);
  assert.strictEqual(c2.ok, false);
  // tamamlanmamış görev claim edilemez
  const c3 = questClaim(s, 'raid', now0);
  assert.strictEqual(c3.ok, false);
  assert.strictEqual(c3.why, 'tamamlanmadi');
});

t('Günlük görevler: yeni günde sıfırlanır + tümü bitince bonus', () => {
  const s = newState(now0);
  // tüm görevleri tamamla
  for (const q of DAILY_QUESTS) {
    questProgress(s, q.id, q.target, now0);
  }
  let totalBonus = 0;
  for (const q of DAILY_QUESTS) {
    const c = questClaim(s, q.id, now0);
    assert.strictEqual(c.ok, true);
    if (c.bonus) totalBonus = c.bonus;
  }
  assert.strictEqual(totalBonus, 100); // tümü bitince bonus
  // yeni günde progress sıfır
  const info2 = questInfo(s, now0 + 86400000);
  assert.strictEqual(info2[0].prog, 0);
  assert.strictEqual(info2[0].claimed, false);
});
