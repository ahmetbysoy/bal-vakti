// 👑 POST /api/admin/* — Tanrı Modu (admin paneli)
// Kimlik doğrulama: iki yöntemden biri yeterli:
//   1) OWNER_ID env'i + Telegram initData (bot içinden /admin butonu ile)
//   2) ADMIN_PASSWORD env'i + şifre (admin.html'de şifre girişi)
// Başarılı giriş → Redis'te 12 saatlik oturum token'ı → sonraki istekler
// "Authorization: Bearer <token>" başlığıyla.
import crypto from 'crypto';
import { getUser, saveUser, getConfig, setConfig, createSession, getSession, deleteSession, allUsers, overview, listBots, getBot, deleteBot } from './lib/db.js';
import { newState, setActiveCfg, getActiveCfg, giveAchievement, playerLevel, ACHIEVEMENTS, MAX_LEVEL, beeCost, kovanCost, depoCost, capacity, totalProd } from './lib/game.js';
import { parseInitData } from './lib/auth.js';
import { createBot, thinkBots, PERSONALITIES, POWER_LEVELS, makeBotState, randPick, AVATAR_POOL } from './lib/brain.js';

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

export default async function handler(req, res) {
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
