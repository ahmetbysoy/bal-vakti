// ⚔️ POST /api/raid — Bal Baskını (PvP)
// Aksiyonlar: world | start | defend | cancel
// Lazy çözüm: her çağrıda süresi dolmuş ve henüz çözülmemiş saldırıları çözer.
import { getUser, saveUser, getActiveRaid, setActiveRaid, clearActiveRaid, getGrudges, tgNotify, syncLb, allUsers, getConfig, allActiveRaids, getEvents } from './lib/db.js';
import { setActiveCfg, resolveRaid, raidPower, warLevel, collect, checkAchievements, playerLevel } from './lib/game.js';
import { parseInitData } from './lib/auth.js';
import { finalizeRaid, RAID_PREP_MS, solveUserRaids, escTg } from './lib/raidcore.js';
import { thinkBots } from './lib/brain.js';

export async function route(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST bekleniyor' });
  const body = req.body || {};

  // 🤖 Savaş sekmesi açılınca dünya canlansın
  try { await thinkBots(); } catch (e) { console.error('🧠 thinkBots hatası:', e?.message || e); }

  let info = null;
  if (body.demo === true && process.env.ALLOW_DEMO === '1' && process.env.VERCEL_ENV !== 'production' && process.env.NODE_ENV !== 'production') {
    info = { user: { id: 1, first_name: 'Kanka', last_name: '' }, startParam: null };
  } else {
    info = parseInitData(body.initData);
  }
  if (!info) return res.status(401).json({ error: 'auth_hatasi' });

  const me = String(info.user.id);
  let st = await getUser(me);
  if (!st) return res.status(404).json({ error: 'oyuncu_yok' });
  if (st.banned) return res.status(403).json({ error: 'banlandin' });

  setActiveCfg(await getConfig());
  collect(st);

  const now = Date.now();
  const action = body.action;
  const result = {};

  // ── Önce: beni ilgilendiren SÜRESİ DOLMUŞ saldırıları çöz (hem savunma hem saldırı) ──
  const solved = await solveUserRaids(me, now);
  if (solved.length) {
    result.solved = solved;
    st = await getUser(me); // çözüm sonrası taze state
  }

  switch (action) {
    case 'world': {
      // Aktif saldırılar tek okuma (performans)
      const actAll = await allActiveRaids();
      // Kendi aktif saldırım (saldırgan olarak)
      let myAttack = null;
      for (const id2 in actAll) {
        if (actAll[id2].a === me) { myAttack = actAll[id2]; break; }
      }
      // Aktif savunma (hedef olarak)
      const myDefense = actAll[me] || null;
      const all = await allUsers(400);

      // Hedef önerileri: güç benzeri oyuncular (ban harici)
      const myPow = raidPower(st);
      // ⚡ Aktif saldırılar TEK istekte toplanır (400 ayrı getActiveRaid YOK)
      const activeAll = await allActiveRaids();
      const buildTargets = (lo, hi) => {
        const list = [];
        for (const { id, st: o } of all) {
          if (String(id) === me || o.banned) continue;
          if (activeAll[id]) continue; // o zaten saldırı altında
          const op = raidPower(o);
          if (op < myPow * lo) continue;
          if (op > myPow * hi) continue;
          list.push({
            id, name: o.name, avatar: o.avatar || '🐝',
            level: playerLevel(o).level, war: warLevel(o.xp || 0).level,
            power: Math.round(op), bal: Math.round(o.bal || 0), bees: o.beesOwned,
            grudge: (o.grudgeDef || 0),
          });
          if (list.length >= 6) break;
        }
        list.sort((a, b) => Math.abs(a.power - myPow) - Math.abs(b.power - myPow));
        return list;
      };
      // 1. aşama: güç dengeli hedefler · 2. aşama (boşsa): geniş aralık — "cesur hedef"
      let targets = buildTargets(0.3, 3);
      let brave = false;
      if (targets.length === 0) {
        targets = buildTargets(0.15, 4);
        brave = true;
      }
      // 3. aşama (hâlâ boşsa): güç filtresi yok — en yakın rakipler, uyarıyla
      if (targets.length === 0) {
        for (const { id, st: o } of all) {
          if (String(id) === me || o.banned) continue;
          if (activeAll[id]) continue;
          targets.push({
            id, name: o.name, avatar: o.avatar || '🐝',
            level: playerLevel(o).level, war: warLevel(o.xp || 0).level,
            power: Math.round(raidPower(o)), bal: Math.round(o.bal || 0), bees: o.beesOwned,
            grudge: (o.grudgeDef || 0),
          });
          if (targets.length >= 6) break;
        }
        targets.sort((a, b) => Math.abs(a.power - myPow) - Math.abs(b.power - myPow));
        brave = true;
      }

      const grudges = (await getGrudges(me)).slice(0, 10).map((g) => ({
        by: g.a, name: g.name, ts: g.ts, won: g.won, stolen: Math.round(g.stolen || 0),
      }));

      result.world = {
        myPower: Math.round(myPow),
        myWar: warLevel(st.xp || 0),
        targets,
        brave,
        grudges,
        events: (await getEvents()).slice(0, 15),
        myAttack: myAttack ? { targetId: myAttack.t, endsAt: myAttack.endsAt, now } : null,
        myDefense: myDefense ? { attacker: myDefense.a, name: myDefense.name, endsAt: myDefense.endsAt, now } : null,
      };
      break;
    }

    case 'start':
    case 'revenge': {
      const targetId = String(body.targetId || '');
      if (!targetId || targetId === me) return res.status(400).json({ error: 'hedef_gecersiz' });
      const target = await getUser(targetId);
      if (!target) return res.status(404).json({ error: 'hedef_yok' });
      if (target.banned) return res.status(400).json({ error: 'hedef_banli' });
      if (await getActiveRaid(targetId)) return res.status(400).json({ error: 'hedef_saldiri_altinda' });
      // Saldırgan zaten birine saldırıyorsa yeni saldırı başlatamaz
      // ⚡ Tek toplu okuma (her kullanıcı için ayrı istek yok)
      const activeAll = await allActiveRaids();
      for (const id2 in activeAll) {
        if (activeAll[id2].a === me) return res.status(400).json({ error: 'zaten_saldiriyorsun' });
      }
      if (activeAll[me]) return res.status(400).json({ error: 'savunmadasin' });

      const raid = {
        a: me,
        aName: st.name || 'Arıcı',
        t: targetId,
        name: target.name || 'Arıcı',
        ats: now,
        endsAt: now + RAID_PREP_MS,
      };
      await setActiveRaid(targetId, raid);

      // 📢 Kurbanına Telegram bildirimi!
      await tgNotify(
        targetId,
        `⚠️ <b>SALDIRI UYARISI!</b>\n\n` +
        `🐝 <b>${escTg(st.name || 'Bir arıcı')}</b> kovanına saldırı başlattı!\n` +
        `⏳ Püskürtmek için <b>${Math.round(RAID_PREP_MS / 1000)} saniyen</b> var.\n\n` +
        `🛡️ Oyunu aç → <b>⚔️ Savaş</b> sekmesi → <b>Püskürt</b>!\n` +
        `(Süre dolarsa arıların hasar alır!)`
      );

      result.raid = { targetId, endsAt: raid.endsAt, now };
      break;
    }

    case 'defend': {
      const active2 = await getActiveRaid(me);
      if (!active2) return res.status(400).json({ error: 'saldiri_yok' });
      if (now < active2.endsAt) {
        // Süre dolmadıysa erken püskürtme: aktif savunma gücüyle hemen çöz
        const resolved = await finalizeRaid(active2, me, true, now);
        result.defend = resolved;
      } else {
        // Süre dolduysa lazy çözüm zaten yaptı
        result.defend = { note: 'zaman_doldu' };
      }
      break;
    }

    case 'cancel': {
      // Saldırgan kendi saldırısını iptal eder → çürüme cezası
      const activeAll2 = await allActiveRaids();
      let found = null;
      for (const id2 in activeAll2) {
        if (activeAll2[id2].a === me) { found = activeAll2[id2]; break; }
      }
      if (!found) return res.status(400).json({ error: 'saldiri_yok' });
      await clearActiveRaid(found.t);
      st.xp = Math.max(0, (st.xp || 0) - 10); // çürüme cezası
      await saveUser(me, st);
      result.cancel = { penalty: 10 };
      break;
    }

    default:
      return res.status(400).json({ error: 'bilinmeyen_aksiyon' });
  }

  const freshAch = checkAchievements(st, now);
  await saveUser(me, st);
  await syncLb(me, st.name, st.totalEarned);

  res.json({
    ok: true,
    ...result,
    state: st,
    freshAch,
    level: playerLevel(st),
    war: warLevel(st.xp || 0),
  });
}
