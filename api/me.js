// 🐝 POST /api/me — oyuncu girişi/oluşturma, üretim işleme, davet ödülleri
import { getUser, saveUser, getRef, setRef, syncLb, myRank, dbMode, getConfig } from '../lib/db.js';
import { newState, collect, checkAchievements, dailyInfo, playerLevel, setActiveCfg, getActiveCfg, REF_INVITER, REF_FRIEND } from '../lib/game.js';
import { parseInitData } from '../lib/auth.js';

export default async function handler(req, res) {
  try {
    return await handle(req, res);
  } catch (e) {
    console.error('me hatası:', e);
    if (!res.headersSent) return res.status(500).json({ error: 'sunucu_hatasi', detail: String(e?.message || e) });
  }
}

async function handle(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST bekleniyor' });
  const body = req.body || {};

  // Canlı konfigürasyon (admin paneli değişiklikleri anında geçerli)
  const cfg = await getConfig();
  setActiveCfg(cfg);
  if (cfg.maintenance) return res.status(503).json({ error: 'bakimda' });

  let info = null;
  if (body.demo === true && process.env.ALLOW_DEMO === '1') {
    info = { user: { id: 1, first_name: 'Kanka', last_name: '' }, startParam: null };
  } else {
    info = parseInitData(body.initData);
  }
  if (!info) return res.status(401).json({ error: 'auth_hatasi' });

  const id = String(info.user.id);
  const name = [info.user.first_name, info.user.last_name].filter(Boolean).join(' ') || 'Anonim';

  let st = await getUser(id);
  let isNew = false;

  if (!st) {
    isNew = true;
    st = newState();
    st.name = name;

    // Davet zinciri: deep link ile gelen kod
    const code = info.startParam;
    if (code) {
      const inviter = await getRef(code);
      if (inviter && inviter !== id) {
        st.inviter = inviter;
        const inv = await getUser(inviter);
        if (inv) {
          inv.refs += 1;
          inv.bal += REF_INVITER;
          inv.totalEarned += REF_INVITER;
          await saveUser(inviter, inv);
          await syncLb(inviter, inv.name, inv.totalEarned);
        }
        st.bal += REF_FRIEND;
        st.totalEarned += REF_FRIEND;
      }
    }
    await setRef(id.toString(36), id);
    await saveUser(id, st);
  } else {
    st.name = name;
  }

  const now = Date.now();
  const gained = collect(st, now);
  const freshAch = checkAchievements(st, now);

  if (st.banned) {
    await saveUser(id, st);
    return res.status(403).json({ error: 'banlandin' });
  }

  await saveUser(id, st);
  await syncLb(id, name, st.totalEarned);

  res.json({
    ok: true,
    id,
    isNew,
    gained,
    freshAch,
    state: st,
    daily: dailyInfo(st, now),
    level: playerLevel(st),
    myRank: await myRank(id),
    dbMode: dbMode(),
    demo: !!info.demo,
    cfg: {
      bot: process.env.BOT_USERNAME || '',
      appUrl: process.env.APP_URL || '',
      vzvzCooldownSec: Math.round(cfg.vzvzCooldownMs / 1000),
      vzvzDurationSec: 10,
      // ekonomi — istemci de aynı değerleri kullansın (admin değişince anında yansır)
      ...getActiveCfg(),
    },
  });
}
