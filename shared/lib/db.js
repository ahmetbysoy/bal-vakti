// 🗄️ Bal Vakti — veritabanı katmanı (3 mod)

import { DEFAULT_CONFIG } from './game.js'; // (yalnızca tip referansı — döngü yok)

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

export function dbMode() {
  return HAS_FIREBASE ? 'firebase' : 'memory';
}

/* ── Oyuncular ── */
export async function getUser(id) { return kvGet(`users/${id}`); }
export async function saveUser(id, state) { return kvSet(`users/${id}`, state); }
export async function allUsers(limit = 1000) {
  const obj = await kvGetAll('users');
  const out = [];
  for (const [id, st] of Object.entries(obj)) {
    if (!st) continue;
    out.push({ id, st });
    if (out.length >= limit) break;
  }
  return out;
}
export async function scanUserKeys(limit = 1000) {
  const users = await allUsers(limit);
  return users.map((u) => `users/${u.id}`);
}

/* ── Referans kodları ── */
export async function getRef(code) {
  const v = await kvGet(`refs/${code}`);
  return v == null ? null : String(v);
}
export async function setRef(code, id) { return kvSet(`refs/${code}`, String(id)); }

/* ── Liderlik tablosu ── */
export async function syncLb(id, name, score) {
  await Promise.all([kvSet(`names/${id}`, name || 'Anonim'), kvSet(`lb/${id}`, score)]);
}
export async function topLb(n = 30) {
  const [lb, names] = await Promise.all([kvGetAll('lb'), kvGetAll('names')]);
  const arr = Object.entries(lb).map(([id, score]) => ({
    id, name: (names && names[id]) || 'Anonim', score: Number(score) || 0,
  }));
  return arr.sort((a, b) => b.score - a.score).slice(0, n);
}
export async function myRank(id) {
  const top = await topLb(10000);
  const i = top.findIndex((x) => x.id === String(id));
  return i < 0 ? null : i + 1;
}

// 🏆 Haftalık / bugünkü sıralama (allUsers'tan hesaplanır — Firebase tek istek)
export async function topWeekly(n = 10) {
  const users = await allUsers(1000);
  return users
    .map(({ id, st }) => ({ id, name: st.name || 'Anonim', score: st.weeklyEarned || 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}
export async function topToday(n = 10) {
  const users = await allUsers(1000);
  return users
    .map(({ id, st }) => ({ id, name: st.name || 'Anonim', score: st.todayEarned || 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

/* ── Canlı konfigürasyon ── */
export async function getConfig() {
  const base = { ...DEFAULT_CONFIG };
  const stored = await kvGet('cfg');
  return { ...base, ...(stored ? safeParse(stored) : {}) };
}
export async function setConfig(partial) {
  const next = { ...(await getConfig()), ...partial };
  await kvSet('cfg', next);
  return next;
}

/* ── Admin oturumları ── */
export async function createSession(token, id) { return kvSet(`adminsess/${token}`, String(id)); }
export async function getSession(token) {
  const v = await kvGet(`adminsess/${token}`);
  return v == null ? null : String(v);
}
export async function deleteSession(token) { return kvDel(`adminsess/${token}`); }

/* ── Toplu istatistik ── */
export async function overview() {
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
export async function getActiveRaid(targetId) { return kvGet(`activeRaids/${targetId}`); }
export async function setActiveRaid(targetId, raid) { return kvSet(`activeRaids/${targetId}`, raid); }
export async function clearActiveRaid(targetId) { return kvDel(`activeRaids/${targetId}`); }
export async function allActiveRaids() { return kvGetAll('activeRaids'); }

export async function addGrudge(targetId, entry) {
  const list = await getGrudges(targetId);
  list.unshift(entry);
  await kvSet(`grudges/${targetId}`, list.slice(0, 30));
}
export async function getGrudges(targetId) {
  const v = await kvGet(`grudges/${targetId}`);
  return Array.isArray(v) ? v : [];
}

export async function addRaidHist(userId, entry) {
  const list = await getRaidHist(userId);
  list.unshift(entry);
  await kvSet(`hist/${userId}`, list.slice(0, 20));
}
export async function getRaidHist(userId) {
  const v = await kvGet(`hist/${userId}`);
  return Array.isArray(v) ? v : [];
}

export async function recentRaiders(targetId, windowMs = 10 * 60 * 1000, now = Date.now()) {
  const gr = await getGrudges(targetId);
  const cutoff = now - windowMs;
  return [...new Set(gr.filter((g) => g.ts >= cutoff).map((g) => g.a))];
}

/* ── Telegram bildirimi ── */
export async function tgNotify(userId, text) {
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
export async function listBots() {
  const obj = await kvGetAll('bots');
  return Object.values(obj).filter(Boolean);
}
export async function getBot(id) { return kvGet(`bots/${id}`); }
export async function saveBot(bot) { return kvSet(`bots/${bot.id}`, bot); }
export async function deleteBot(id) {
  await Promise.all([
    kvDel(`bots/${id}`), kvDel(`users/${id}`), kvDel(`names/${id}`), kvDel(`lb/${id}`),
  ]);
}
export async function nextBotId() {
  const n = (Number(await kvGet('botseq')) || 0) + 1;
  await kvSet('botseq', n);
  return `bot_${n}`;
}

/* ── Beyin kilidi ── */
export async function brainLock(ttlSec = 60) {
  const last = await kvGet('brainlock');
  if (last && Date.now() - Number(last) < ttlSec * 1000) return false;
  await kvSet('brainlock', Date.now());
  return true;
}

/* ── 🌍 Dünya olayları ── */
export async function addEvent(entry) {
  const list = await getEvents();
  list.unshift({ ts: Date.now(), ...entry });
  await kvSet('events', list.slice(0, 30));
}
export async function getEvents() {
  const v = await kvGet('events');
  return Array.isArray(v) ? v : [];
}

// 🎡 Dünya sayaçları (çark çevrilme, toplam kazanılan/kaybedilen)
export async function bumpCounter(key, delta = 1) {
  const cur = Number(await kvGet(`cnt/${key}`)) || 0;
  await kvSet(`cnt/${key}`, cur + delta);
  return cur + delta;
}
export async function getCounters() {
  const obj = await kvGetAll('cnt');
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = Number(v) || 0;
  return out;
}

// 💥 Gelen emoji bombaları (kurban oyuna girince animasyon için)
export async function addIncomingEmoji(targetId, entry) {
  const list = await getIncomingEmojis(targetId);
  list.unshift(entry);
  await kvSet(`emojiIn/${targetId}`, list.slice(0, 20));
}
export async function getIncomingEmojis(targetId) {
  const v = await kvGet(`emojiIn/${targetId}`);
  return Array.isArray(v) ? v : [];
}
export async function clearIncomingEmojis(targetId) {
  await kvDel(`emojiIn/${targetId}`);
}
