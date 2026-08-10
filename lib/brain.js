// 🧠 Yapay Zekâ Arıcılar — bot beyni
// Her botun kişiliği ve zekâ parametreleri vardır; "uyanma" aralığında
// karar ağacını çalıştırır: savun → intikam → koalisyon → hedef seç → saldır.
import {
  getUser, saveUser, listBots, getActiveRaid, setActiveRaid, getGrudges, allUsers, tgNotify, brainLock, syncLb, nextBotId, saveBot,
} from './db.js';
import { newState, collect, raidPower, warLevel, checkAchievements, playerLevel, MAX_LEVEL } from './game.js';
import { finalizeRaid, RAID_PREP_MS, escTg } from './raidcore.js';

// ── Kişilik tanımları ──
export const PERSONALITIES = {
  predator: { label: 'Akıllı Saldırgan', emoji: '🦅', ai: { aggr: 80, strat: 90, venge: 30, pack: 20 }, interval: [3, 6] },
  warrior:  { label: 'Savaşçı',         emoji: '⚔️', ai: { aggr: 95, strat: 40, venge: 40, pack: 30 }, interval: [2, 4] },
  grudge:   { label: 'Kindar',          emoji: '😤', ai: { aggr: 60, strat: 50, venge: 95, pack: 40 }, interval: [3, 6] },
  pack:     { label: 'Toplulukçu',      emoji: '🐝', ai: { aggr: 50, strat: 30, venge: 60, pack: 95 }, interval: [3, 7] },
  passive:  { label: 'Bal Toplayıcı',   emoji: '🍯', ai: { aggr: 10, strat: 70, venge: 50, pack: 20 }, interval: [6, 12] },
  chaos:    { label: 'Deli Arı',        emoji: '🌀', ai: { aggr: 90, strat: 5,  venge: 30, pack: 50 }, interval: [2, 5] },
};

// ── İsim & avatar havuzu (her bot benzersiz) ──
export const NAME_POOL = [
  'Bal Hırsızı Kemal', 'Kovan Sarsan', 'Vızıltı Veli', 'Oğul Okan', 'Poyraz', 'Sinsi Sami',
  'Kaçak Arıcı', 'Deli Dumrul', 'Tombul Tony', 'Keskin Göz', 'Şahin Bey', 'Mırnav',
  'Çekirge', 'Bal Dükü', 'Kara Kovan', 'Sarı Sıcak', 'Arı Dede', 'Petek Recep',
  'Oğulcan', 'Kızgın Kamil', 'Zarif Ziya', 'Cırcır', 'Hınzır Hamza', 'Vahşi Vahit',
  'Gizli Gözcü', 'Sürü Beyi', 'Kraliçe Arı', 'İşçi Buse', 'Petek Pınar', 'Tatlı Belalı',
  'Kovan Deviren', 'Sessiz Savaşçı', 'Gece Bekçisi', 'Fırtına', 'Kıvılcım', 'Bal Küpü',
  'Acı Bal', 'Zehirli İğne', 'Altın Kanat', 'Çalışkan Karınca', 'Kral Oğul', 'Bozkurt',
];
export const AVATAR_POOL = ['🐝', '🦅', '🐞', '🦗', '🐜', '🦂', '🐛', '🕷️', '🦟', '🐌', '🦎', '🐊', '🦀', '🦋', '🐢', '🐙'];

export function randPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
export function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
export function randName(existing) {
  const taken = new Set(existing.map((b) => b.name));
  const pool = NAME_POOL.filter((n) => !taken.has(n));
  if (pool.length) return randPick(pool);
  return randPick(NAME_POOL) + ' ' + randInt(2, 99);
}

// ── Güç seviyeleri ──
export const POWER_LEVELS = {
  zayif:   { label: 'Zayıf',   bees: [3, 8],   kovan: 0, depo: 0, bal: [300, 1200] },
  orta:    { label: 'Orta',    bees: [12, 28], kovan: 1, depo: 1, bal: [2000, 8000] },
  guclu:   { label: 'Güçlü',   bees: [35, 90], kovan: [2, 4], depo: 2, bal: [15000, 60000] },
  efsane:  { label: 'Efsane',  bees: [120, 350], kovan: [5, 8], depo: 4, bal: [100000, 500000] },
};

// Bot oyuncu durumu üret (güç seviyesine göre)
export function makeBotState(levelKey = 'orta', now = Date.now()) {
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
export async function createBot({ personality = 'warrior', powerLevel = 'orta', enabled = true } = {}) {
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
export async function thinkBots({ force = false } = {}) {
  if (!force && !(await brainLock(60))) return { ran: false };
  const bots = await listBots();
  const now = Date.now();
  let acted = 0;
  for (const b of bots) {
    if (!b.enabled) continue;
    if (!force && now - (b.lastThink || 0) < (b.intervalMs || 300000)) continue;
    b.lastThink = now;
    await saveBot(b);
    try {
      const did = await thinkBot(b, now);
      if (did) acted++;
    } catch (e) {
      console.error('🧠 bot hatası', b.id, e?.message || e);
    }
  }
  return { ran: true, bots: bots.length, acted };
}

// ── Tek bot karar ağacı ──
async function thinkBot(b, now) {
  const me = b.id;
  const st = await getUser(me);
  if (!st) return false;
  collect(st);
  const ai = b.ai;

  // 1) SAVUNMA: aktif saldırı altında mıyım?
  const activeDef = await getActiveRaid(me);
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

  // Kendi saldırım varsa (saldırgan olarak) — zaten lazy çözülür; bekle
  const all = await allUsers(2000);
  for (const { id } of all) {
    if (String(id) === me) continue;
    const r = await getActiveRaid(id);
    if (r && String(r.a) === me) { await saveUser(me, st); return false; }
  }

  // 2) İNTİKAM: son 30 dk içinde bana kazananla saldıran oldu mu?
  if (Math.random() < ai.venge / 100) {
    const grudges = await getGrudges(me);
    const recent = grudges.filter((g) => now - g.ts < 30 * 60 * 1000);
    for (const g of recent) {
      if (g.won && !(await getActiveRaid(g.a))) {
        const started = await startRaidAs(b, g.a, now);
        await saveUser(me, st);
        return started;
      }
    }
  }

  // 3) KOALİSYON: sürücülük yüksekse, saldırı altındaki bir hedefe katıl
  if (Math.random() < ai.pack / 100) {
    for (const { id, st: o } of all) {
      if (String(id) === me || o.banned) continue;
      const r = await getActiveRaid(id);
      if (r && String(r.a) !== me) {
        const started = await startRaidAs(b, id, now);
        await saveUser(me, st);
        return started;
      }
    }
  }

  // 4) NORMAL SALDIRI
  if (Math.random() < ai.aggr / 100) {
    const target = await pickTarget(st, b, all, now);
    if (target) {
      const started = await startRaidAs(b, target, now);
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

// ── Hedef seçimi (stratejiye göre güç aralığı) ──
async function pickTarget(st, b, all, now) {
  const myPow = raidPower(st);
  const strat = b.ai.strat;
  const aggr = b.ai.aggr;
  const cands = [];
  for (const { id, st: o } of all) {
    if (String(id) === b.id || o.banned) continue;
    if (o.banned) continue;
    if (await getActiveRaid(id)) continue; // saldırı altındakine saldırma (koalisyon ayrı)
    if (String(id) === b.id) continue;
    const op = raidPower(o);
    let ok = false;
    if (strat > 70) ok = op > myPow * 0.35 && op < myPow * 1.05;      // akıllı: kazanabileceği
    else if (strat > 35) ok = op > myPow * 0.25 && op < myPow * 1.45; // orta: cesur
    else ok = true;                                                    // deli: herkes
    if (!ok) continue;
    cands.push({ id, name: o.name, op, bal: o.bal || 0 });
  }
  if (!cands.length) return null;
  // Sıralama: stratejik → güç oranı en iyi; agresif → en zengin
  if (strat > 55) {
    cands.sort((a, b2) => Math.abs(a.op - myPow) - Math.abs(b2.op - myPow));
  } else {
    cands.sort((a, b2) => (b2.bal * (aggr / 100)) - (a.bal * (aggr / 100)) || (a.op - b2.op));
  }
  return cands[0].id;
}

// ── Saldırı başlat (bot olarak) ──
async function startRaidAs(b, targetId, now) {
  const target = await getUser(targetId);
  if (!target || target.banned) return false;
  if (await getActiveRaid(targetId)) return false;
  const st = await getUser(b.id);
  if (!st) return false;
  collect(st);
  const raid = {
    a: b.id, aName: b.name || 'Bir arıcı',
    t: targetId, name: target.name || 'Arıcı',
    ats: now, endsAt: now + RAID_PREP_MS,
  };
  await setActiveRaid(targetId, raid);
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
