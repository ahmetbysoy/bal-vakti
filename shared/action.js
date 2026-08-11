// 🐝 POST /api/action — oyun aksiyonları (tek uç, tek doğrulama noktası)
// Aksiyonlar: collect | buy_bee | upgrade | daily | vzvz_end
import { getUser, saveUser, syncLb, myRank, getConfig, bumpCounter } from './lib/db.js';
import { collect, buyBee, upgrade, claimDaily, vzvzPlay, checkAchievements, dailyInfo, playerLevel, setActiveCfg, newState, spinWheel, gambleCoin, gambleSlot } from './lib/game.js';
import { parseInitData } from './lib/auth.js';

export async function route(req, res) {
  try {
    return await handle(req, res);
  } catch (e) {
    console.error('action hatası:', e);
    if (!res.headersSent) return res.status(500).json({ error: 'sunucu_hatasi', detail: String(e?.message || e) });
  }
}

async function handle(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST bekleniyor' });
  const body = req.body || {};

  // Canlı konfigürasyon
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
  let st = await getUser(id);
  if (!st) return res.status(404).json({ error: 'oyuncu_yok' });
  if (st.banned) return res.status(403).json({ error: 'banlandin' });

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
    case 'rename': {
      const nm = String(payload.name || '').replace(/<[^>]*>/g, '').trim().slice(0, 24);
      if (!nm) return res.status(400).json({ error: 'isim_gerekli' });
      st.name = nm;
      result = { name: nm };
      break;
    }
    case 'avatar': {
      const av = String(payload.avatar || '').trim();
      if (!av || [...av].length > 2) return res.status(400).json({ error: 'avatar_gecersiz' });
      st.avatar = av;
      result = { avatar: av };
      break;
    }
    case 'reset_me': {
      const keepName = st.name;
      const keepAvatar = st.avatar;
      st = newState();
      st.name = keepName;
      if (keepAvatar) st.avatar = keepAvatar;
      result = { reset: true };
      break;
    }
    case 'vzvz_end': {
      const r = vzvzPlay(st, Number(payload.taps) || 0, Number(payload.durMs) || 0, now);
      if (!r.ok) return res.status(400).json({ error: r.why });
      result = r;
      break;
    }
    case 'spin': {
      const r = spinWheel(st, now);
      if (!r.ok) return res.status(400).json({ error: r.why });
      await bumpCounter('spin');
      result = r;
      break;
    }
    case 'gamble': {
      const bet = Math.floor(Number(payload.bet) || 0);
      const game = payload.game === 'slot' ? 'slot' : 'coin';
      const r = game === 'slot' ? gambleSlot(st, bet, now) : gambleCoin(st, bet, now);
      if (!r.ok) return res.status(400).json({ error: r.why });
      result = { ...r, game };
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
