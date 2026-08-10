// ⚔️ POST /api/raid — Bal Baskını (PvP)
// Aksiyonlar: world | start | defend | cancel
// Lazy çözüm: her çağrıda süresi dolmuş ve henüz çözülmemiş saldırıları çözer.
import { getUser, saveUser, getActiveRaid, setActiveRaid, clearActiveRaid, addGrudge, getGrudges, addRaidHist, recentRaiders, tgNotify, syncLb, allUsers, getConfig } from '../lib/db.js';
import { setActiveCfg, getActiveCfg, resolveRaid, mutualRaidPenalty, coalitionBonus, raidPower, warLevel, collect, checkAchievements, playerLevel } from '../lib/game.js';
import { parseInitData } from '../lib/auth.js';

const RAID_PREP_MS = 30 * 1000; // 30 sn hazırlık ("çürüme" penceresi)

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

  const me = String(info.user.id);
  let st = await getUser(me);
  if (!st) return res.status(404).json({ error: 'oyuncu_yok' });
  if (st.banned) return res.status(403).json({ error: 'banlandin' });

  setActiveCfg(await getConfig());
  collect(st);

  const now = Date.now();
  const action = body.action;
  const result = {};

  // ── Önce: süresi dolmuş saldırıları çöz (lazy) ──
  const active = await getActiveRaid(me); // hedef olarak aktif saldırı
  if (active && now >= active.endsAt) {
    const resolved = await finalizeRaid(active, me, false, now);
    result.lazy = resolved;
  }

  switch (action) {
    case 'world': {
      // Kendi aktif saldırım (saldırgan olarak)
      let myAttack = null;
      const all = await allUsers(2000);
      for (const { id, st: o } of all) {
        if (String(id) === me) continue;
        const r = await getActiveRaid(id);
        if (r && String(r.a) === me) { myAttack = r; break; }
      }
      // Aktif savunma (hedef olarak)
      const myDefense = await getActiveRaid(me);

      // Hedef önerileri: güç benzeri oyuncular (XP'li hesap dışı, ban harici)
      const myPow = raidPower(st);
      const targets = [];
      for (const { id, st: o } of all) {
        if (String(id) === me || o.banned) continue;
        if (await getActiveRaid(id)) continue; // o zaten saldırı altında
        const op = raidPower(o);
        if (op < myPow * 0.3) continue; // çok zayıf — laçka kavgası olmasın
        if (op > myPow * 3) continue;   // çok güçlü
        targets.push({
          id, name: o.name, avatar: o.avatar || '🐝',
          level: playerLevel(o).level, war: warLevel(o.xp || 0).level,
          power: Math.round(op), bal: Math.round(o.bal || 0), bees: o.beesOwned,
          grudge: (o.grudgeDef || 0),
        });
        if (targets.length >= 6) break;
      }
      targets.sort((a, b) => Math.abs(a.power - myPow) - Math.abs(b.power - myPow));

      const grudges = (await getGrudges(me)).slice(0, 10).map((g) => ({
        by: g.a, name: g.name, ts: g.ts, won: g.won, stolen: Math.round(g.stolen || 0),
      }));

      result.world = {
        myPower: Math.round(myPow),
        myWar: warLevel(st.xp || 0),
        targets,
        grudges,
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
      const all = await allUsers(2000);
      for (const { id, st: o } of all) {
        if (String(id) === me) continue;
        const r = await getActiveRaid(id);
        if (r && String(r.a) === me) return res.status(400).json({ error: 'zaten_saldiriyorsun' });
      }
      if (await getActiveRaid(me)) return res.status(400).json({ error: 'savunmadasin' });

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
      const all2 = await allUsers(2000);
      let found = null;
      for (const { id, st: o } of all2) {
        if (String(id) === me) continue;
        const r = await getActiveRaid(id);
        if (r && String(r.a) === me) { found = r; break; }
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

// ── Saldırıyı çöz ve sonuçları uygula ──
export async function finalizeRaid(raid, defenderId, defendActive, now) {
  const A = await getUser(raid.a);
  const T = await getUser(raid.t);
  await clearActiveRaid(raid.t);
  if (!A || !T || A.banned) return { note: 'iptal' };

  collect(A); collect(T);
  const r = resolveRaid(A, T, defendActive, now);

  // Koalisyon kontrolü (aynı hedefe son 10 dk içinde başka saldırgan var mı?)
  const raiders = await recentRaiders(raid.t, 10 * 60 * 1000, now);
  const coal = coalitionBonus(A, raiders.length + 1); // kendisi dahil

  // Karşılıklı saldırı cezası (T→A saldırısı son 10 dk içinde var mı?)
  let mutual = null;
  const tGrudges = await getGrudges(raid.t);
  const myRecent = await recentRaiders(raid.a, 10 * 60 * 1000, now);
  if (myRecent.includes(raid.t)) {
    mutual = mutualRaidPenalty(A, T, now);
  }

  // Kin kaydı (kurban perspektifi)
  await addGrudge(raid.t, {
    a: raid.a, name: raid.aName, ts: now, won: r.winner === 'A',
    stolen: r.stolen, xpGain: r.xpA, coal,
  });

  // Savaş geçmişleri
  const histA = {
    type: r.winner === 'A' ? 'win' : r.winner === 'T' ? 'loss' : 'draw',
    vs: raid.name, ts: now, xp: r.xpA, stolen: r.stolen, coal, mutual: !!mutual,
  };
  const histT = {
    type: r.winner === 'T' ? 'win' : r.winner === 'A' ? 'loss' : 'draw',
    vs: raid.aName, ts: now, xp: r.xpT, defenseGain: r.defenseGain,
    beesKilled: r.beesKilled, coal: coal > 0,
  };
  await addRaidHist(raid.a, histA);
  await addRaidHist(raid.t, histT);

  await saveUser(raid.a, A);
  await saveUser(raid.t, T);
  await syncLb(raid.a, A.name, A.totalEarned);
  await syncLb(raid.t, T.name, T.totalEarned);

  // 📢 Sonuç bildirimleri
  const tW = warLevel(T.xp || 0).level;
  const aW = warLevel(A.xp || 0).level;

  if (r.winner === 'A') {
    await tgNotify(raid.t,
      `💥 <b>Kovanın yağmalandı!</b>\n\n` +
      `${escTg(raid.aName)} saldırını püskürtemedi.\n` +
      `🍯 <b>${fmtTg(r.stolen)} bal</b> çalındı · 🐝 ${r.beesKilled} arı hasar gördü\n` +
      `🛡️ Savunma geliri: <b>+${fmtTg(r.defenseGain)} bal</b>\n` +
      (r.beesKilled >= 2 ? `🩸 <i>Savunma gelirin eşiği aştı — arıların öldü!</i>\n` : '') +
      `😠 Kin: <b>+1</b> — İntikam vakti! ⚔️`);
    await tgNotify(raid.a,
      `⚔️ <b>SALDIRI BAŞARILI!</b>\n\n` +
      `${escTg(raid.name)}'in kovanını yağmaladın!\n` +
      `⭐ +${r.xpA} XP · 🍯 +${fmtTg(r.stolen)} bal çaldın\n` +
      (coal > 0 ? `🤝 Koalisyon bonusu: +${coal} XP\n` : '') +
      `Savaşçı seviyen: <b>${aW}</b>`);
  } else if (r.winner === 'T') {
    await tgNotify(raid.t,
      `🛡️ <b>PÜSKÜRTTÜN!</b>\n\n` +
      `${escTg(raid.aName)}'in saldırısını savdın!\n` +
      `⭐ +${r.xpT} XP · 🍯 Savunma geliri +${fmtTg(r.defenseGain)} bal\n` +
      `😤 Saldırgan ${fmtTg(15)} XP kaybetti (ceza)\n` +
      `İntikam listene eklendi! ⚔️`);
    await tgNotify(raid.a,
      `🩸 <b>PÜSKÜRTÜLDÜN!</b>\n\n` +
      `${escTg(raid.name)} saldırını savdı!\n` +
      `⭐ <b>−15 XP</b> (ceza) — savaşçı seviyen: <b>${aW}</b>\n` +
      `Bir dahaki sefere daha güçlü gel! 🐝`);
  } else {
    await tgNotify(raid.t, `🤝 ${escTg(raid.aName)} ile saldırın berabere bitti. İki taraf da +2 XP aldı.`);
    await tgNotify(raid.a, `🤝 ${escTg(raid.name)} ile savaşın berabere bitti. +2 XP aldın.`);
  }

  return {
    winner: r.winner, ratio: r.ratio, xpA: r.xpA, xpT: r.xpT,
    stolen: r.stolen, beesKilled: r.beesKilled, defenseGain: r.defenseGain,
    coal, mutual: mutual ? mutual.penalty : 0,
    aName: raid.aName, tName: raid.name,
    wA: aW, wT: tW,
  };
}

function escTg(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmtTg(n) {
  n = Math.floor(n || 0);
  return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
}
