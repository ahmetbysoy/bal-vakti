// 🐝 POST /api/action — oyun aksiyonları (tek uç, tek doğrulama noktası)
// Aksiyonlar: collect | buy_bee | upgrade | daily | vzvz_end
import { getUser, saveUser, syncLb, myRank, getConfig, bumpCounter, addIncomingEmoji, addEvent, tgNotify, getIncomingEmojis, clearIncomingEmojis } from './lib/db.js';
import { escTg } from './raidcore.js';
import { collect, buyBee, upgrade, claimDaily, vzvzPlay, checkAchievements, dailyInfo, playerLevel, setActiveCfg, newState, spinWheel, openChest, throwEmoji, THROW_EMOJI_COST, questProgress, questClaim, questInfo, warLevel, playBalloon, playTimer } from './lib/game.js';
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
  if (body.demo === true && process.env.ALLOW_DEMO === '1' && process.env.VERCEL_ENV !== 'production' && process.env.NODE_ENV !== 'production') {
    info = { user: { id: 1, first_name: 'Kanka', last_name: '' }, startParam: null };
  } else {
    info = parseInitData(body.initData);
  }
  if (!info) return res.status(401).json({ error: 'auth_hatasi' });

  const id = String(info.user.id);
  const me = id;
  let st = await getUser(id);
  if (!st) return res.status(404).json({ error: 'oyuncu_yok' });
  if (st.banned) return res.status(403).json({ error: 'banlandin' });

  const now = Date.now();
  const balBefore = st.bal;
  const collected = collect(st, now); // her işlemde bekleyen üretim işlenir
  const gained = st.bal - balBefore;

  const action = body.action;
  const payload = body.payload || {};
  let result = {};

  switch (action) {
    case 'collect':
      if (gained > 0) questProgress(st, 'collect', 1, now);
      result = { collected: gained };
      break;
    case 'buy_bee': {
      const r = buyBee(st, 1);
      if (!r.ok) return res.status(400).json({ error: r.why });
      questProgress(st, 'buy', 1, now);
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
      questProgress(st, 'vzvz', 1, now);
      result = r;
      break;
    }
    case 'spin': {
      const r = spinWheel(st, now);
      if (!r.ok) return res.status(400).json({ error: r.why });
      await bumpCounter('spin');
      questProgress(st, 'spin', 1, now);
      result = r;
      break;
    }
    case 'chest': {
      const card = Math.max(0, Math.min(2, Number(payload.card) || 0));
      const r = openChest(st, card, now);
      if (!r.ok) return res.status(400).json({ error: r.why });
      result = r;
      break;
    }
    case 'minigame': {
      const game = payload.game;
      if (game === 'balloon') {
        const r = playBalloon(st, Math.floor(Number(payload.score) || 0), now);
        if (!r.ok) return res.status(400).json({ error: r.why });
        result = r;
      } else if (game === 'timer') {
        const r = playTimer(st, Number(payload.stoppedAt) || 0, Number(payload.target) || 0, now);
        if (!r.ok) return res.status(400).json({ error: r.why });
        result = r;
      } else return res.status(400).json({ error: 'bilinmeyen_oyun' });
      break;
    }
    case 'quest_claim': {
      const r = questClaim(st, String(payload.questId || ''), now);
      if (!r.ok) return res.status(400).json({ error: r.why });
      result = r;
      break;
    }
    case 'throw_emoji': {
      const targetId = String(payload.targetId || '');
      const emoji = String(payload.emoji || '');
      if (!targetId || targetId === me) return res.status(400).json({ error: 'hedef_gecersiz' });
      const target = await getUser(targetId);
      if (!target) return res.status(404).json({ error: 'hedef_yok' });
      if (target.banned) return res.status(400).json({ error: 'hedef_banli' });
      const r = throwEmoji(st, targetId, emoji, now);
      if (!r.ok) return res.status(400).json({ error: r.why });
      await addIncomingEmoji(targetId, { by: me, byName: st.name || 'Bir arıcı', emoji, ts: now });
      await addEvent({ type: 'emoji', emoji: '💥', txt: `${st.name || 'Bir arıcı'}, ${target.name || 'Bir arıcı'}'e ${emoji} fırlattı!` });
      await tgNotify(targetId, `💥 ${escTg(st.name || 'Bir arıcı')} sana ${emoji} fırlattı! 😂 Oyunu aç ve gör!`);
      result = { emoji, targetId, cost: THROW_EMOJI_COST };
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
    war: warLevel(st.xp || 0),
    myRank: await myRank(id),
    quests: questInfo(st, now),
  });
}
