// 🗄️ Bal Vakti — veritabanı katmanı
// UPSTASH_REDIS_* env'leri tanımlıysa Upstash Redis kullanılır (Vercel + ücretsiz tier).
// Tanımlı değilse bellek modu devreye girer (yerel test için; Vercel'de veriler kaybolur!).

import { Redis } from '@upstash/redis';
import { DEFAULT_CONFIG } from './game.js';

const HAS_REDIS = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
const redis = HAS_REDIS
  ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
  : null;

const mem = new Map();
const P = (k) => `balvakti:${k}`;

// @upstash/redis değerleri otomatik ayrıştırır (object döner);
// bellek modu string saklar. İkisini de güvenle işler.
function safeParse(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

export function dbMode() {
  return redis ? 'upstash' : 'memory';
}

export async function getUser(id) {
  if (redis) {
    const v = await redis.get(P(`u:${id}`));
    return safeParse(v);
  }
  const v = mem.get(P(`u:${id}`));
  return safeParse(v);
}

export async function saveUser(id, state) {
  const s = JSON.stringify(state);
  if (redis) await redis.set(P(`u:${id}`), s);
  else mem.set(P(`u:${id}`), s);
}

// Referans kodları: kod → davet edenin id'si (1 yıl geçerli)
export async function getRef(code) {
  const v = redis ? await redis.get(P(`ref:${code}`)) : mem.get(P(`ref:${code}`));
  return v == null ? null : String(v); // "123" JSON otomatik sayıya dönebilir → string'e çevir
}
export async function setRef(code, id) {
  if (redis) await redis.set(P(`ref:${code}`), String(id), { ex: 60 * 60 * 24 * 365 });
  else mem.set(P(`ref:${code}`), String(id));
}

// Liderlik tablosu
export async function syncLb(id, name, score) {
  if (redis) {
    await redis.zadd(P('lb'), { score, member: String(id) });
    await redis.set(P(`name:${id}`), name || 'Anonim');
  } else {
    mem.set(P(`name:${id}`), name || 'Anonim');
    mem.set(P(`lb:${id}`), score);
  }
}

export async function topLb(n = 30) {
  if (redis) {
    // @upstash/redis: zrevrange yerine zrange(..., { rev: true, withScores: true })
    const rows = await redis.zrange(P('lb'), 0, n - 1, { rev: true, withScores: true });
    const arr = Array.isArray(rows) ? rows : [];
    const out = [];
    for (let i = 0; i + 1 < arr.length; i += 2) {
      const id = String(arr[i]);
      const name = (await redis.get(P(`name:${id}`))) || 'Anonim';
      out.push({ id, name, score: Number(arr[i + 1]) });
    }
    return out;
  }
  const arr = [...mem.entries()]
    .filter(([k]) => k.startsWith(P('lb:')))
    .map(([k, v]) => ({ id: k.slice(P('lb:').length), score: v }));
  return arr
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => ({ id: x.id, name: mem.get(P(`name:${x.id}`)) || 'Anonim', score: x.score }));
}

export async function myRank(id) {
  if (redis) {
    const r = await redis.zrevrank(P('lb'), String(id));
    return r === null ? null : r + 1;
  }
  const arr = [...mem.entries()]
    .filter(([k]) => k.startsWith(P('lb:')))
    .map(([k, v]) => ({ id: k.slice(P('lb:').length), score: v }))
    .sort((a, b) => b.score - a.score);
  const i = arr.findIndex((x) => x.id === String(id));
  return i < 0 ? null : i + 1;
}

// ── Canlı konfigürasyon (admin paneli) ──
export async function getConfig() {
  const base = { ...DEFAULT_CONFIG };
  if (redis) {
    const stored = await redis.get(P('cfg'));
    if (stored) return { ...base, ...safeParse(stored) };
    return base;
  }
  const stored = mem.get(P('cfg'));
  return { ...base, ...(stored ? safeParse(stored) : {}) };
}
export async function setConfig(partial) {
  const next = { ...(await getConfig()), ...partial };
  if (redis) await redis.set(P('cfg'), JSON.stringify(next));
  else mem.set(P('cfg'), JSON.stringify(next));
  return next;
}

// ── Admin oturumları (12 saat geçerli token) ──
export async function createSession(token, id) {
  if (redis) await redis.set(P(`adminsess:${token}`), String(id), { ex: 43200 });
  else mem.set(P(`adminsess:${token}`), String(id));
}
export async function getSession(token) {
  const v = redis ? await redis.get(P(`adminsess:${token}`)) : mem.get(P(`adminsess:${token}`));
  return v == null ? null : String(v);
}
export async function deleteSession(token) {
  if (redis) await redis.del(P(`adminsess:${token}`));
  else mem.delete(P(`adminsess:${token}`));
}

// ── Tüm oyuncu anahtarlarını tara (admin: arama, toplu bonus, istatistik) ──
export async function scanUserKeys(limit = 1000) {
  const prefix = P('u:');
  if (redis) {
    const keys = [];
    let cur = '0';
    do {
      const [nc, ks] = await redis.scan(cur, { match: `${prefix}*`, count: 100 });
      keys.push(...(Array.isArray(ks) ? ks : []));
      cur = nc;
    } while (cur !== '0' && keys.length < limit);
    return keys;
  }
  return [...mem.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit);
}

export async function allUsers(limit = 1000) {
  const keys = await scanUserKeys(limit);
  const out = [];
  for (const k of keys) {
    const id = k.replace(P('u:'), '');
    const st = await getUser(id);
    if (st) out.push({ id, st });
  }
  return out;
}

// ── Toplu istatistik (admin paneli) ──
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
