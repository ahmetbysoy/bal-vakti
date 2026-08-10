// 🐝 POST /api/action — oyun aksiyonları (tek uç, tek doğrulama noktası)
// Aksiyonlar: collect | buy_bee | upgrade | daily | vzvz_end
import { getUser, saveUser, syncLb, myRank } from '../lib/db.js';
import { collect, buyBee, upgrade, claimDaily, vzvzPlay, checkAchievements, dailyInfo, playerLevel } from '../lib/game.js';
import { parseInitData } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST bekleniyor' });
  const body = req.body || {};

  let info = null;
  if (body.demo === true && process.env.ALLOW_DEMO === '1') {
    info = { user: { id: 1, first_name: 'Kanka', last_name: '' }, startParam: null };
  } else {
    info = parseInitData(body.initData);
  }
  if (!info) return res.status(401).json({ error: 'auth_hatasi' });

  const id = String(info.user.id);
  let st = await getUser(id);
  if (!st) return res.status(404).json({ error: 'oyuncu_yok' });

  const now = Date.now();
  const balBefore = st.bal;
  collect(st, now); // her işlemde bekleyen üretim işlenir
  const gained = st.bal - balBefore;

  const action = body.action;
  const payload = body.payload || {};
  let result = {};

  switch (action) {
    case 'collect':
      result = { collected: gained };
      break;
    case 'buy_bee': {
      const r = buyBee(st, 1);
      if (!r.ok) return res.status(400).json({ error: r.why });
      result = { cost: r.cost, merges: r.merges };
      break;
    }
    case 'upgrade': {
      if (payload.which !== 'kovan' && payload.which !== 'depo') return res.status(400).json({ error: 'bilinmeyen_yukseltme' });
      const r = upgrade(st, payload.which);
      if (!r.ok) return res.status(400).json({ error: r.why });
      result = { cost: r.cost, which: payload.which };
      break;
    }
    case 'daily': {
      const r = claimDaily(st, now);
      if (!r) return res.status(400).json({ error: 'bugun_aldi' });
      result = r;
      break;
    }
    case 'vzvz_end': {
      const r = vzvzPlay(st, Number(payload.taps) || 0, Number(payload.durMs) || 0, now);
      if (!r.ok) return res.status(400).json({ error: r.why });
      result = r;
      break;
    }
    default:
      return res.status(400).json({ error: 'bilinmeyen_aksiyon' });
  }

  const freshAch = checkAchievements(st, now);
  await saveUser(id, st);
  await syncLb(id, st.name, st.totalEarned);

  res.json({
    ok: true,
    ...result,
    state: st,
    freshAch,
    daily: dailyInfo(st, now),
    level: playerLevel(st),
    myRank: await myRank(id),
  });
}
