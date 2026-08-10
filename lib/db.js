// 🗄️ Bal Vakti — veritabanı katmanı
// UPSTASH_REDIS_* env'leri tanımlıysa Upstash Redis kullanılır (Vercel + ücretsiz tier).
// Tanımlı değilse bellek modu devreye girer (yerel test için; Vercel'de veriler kaybolur!).

import { Redis } from '@upstash/redis';

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
    const rows = await redis.zrevrange(P('lb'), 0, n - 1, { withScores: true });
    const out = [];
    for (let i = 0; i < rows.length; i += 2) {
      const id = rows[i];
      const name = (await redis.get(P(`name:${id}`))) || 'Anonim';
      out.push({ id, name, score: Number(rows[i + 1]) });
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
