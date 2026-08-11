// ⚔️ Raid çözüm çekirdeği — api/raid.js, api/me.js, lib/brain.js ortak kullanır
// (API'ler arası döngüyü önlemek için ayrı modül)
import { getUser, saveUser, clearActiveRaid, addGrudge, getGrudges, addRaidHist, recentRaiders, tgNotify, syncLb, allActiveRaids, addEvent, bumpCounter } from './db.js';
import { collect, resolveRaid, mutualRaidPenalty, coalitionBonus, warLevel } from './game.js';

export const RAID_PREP_MS = 15 * 1000; // 15 sn hazırlık ("çürüme" penceresi)

// ── Kullanıcıyı ilgilendiren SÜRESİ DOLMUŞ saldırıları çöz ──
// Hem savunma (bana saldırılmış) hem saldırı (ben saldırmışım) tarafında çalışır.
// Böylece saldırılar kurbanın girişine bağımlı kalmaz — kim girerse girsin çözülür,
// "zaten saldırıyorsun" kilidi bir daha yaşanmaz.
export async function solveUserRaids(userId, now = Date.now()) {
  const raids = await allActiveRaids();
  const results = [];
  // 1) Savunma: bana saldırılmış ve süresi dolmuş
  const def = raids[userId];
  if (def && now >= def.endsAt) {
    results.push(await finalizeRaid(def, userId, false, now));
  }
  // 2) Saldırı: ben saldırmışım ve süresi dolmuş
  for (const k in raids) {
    const r = raids[k];
    if (r.a === userId && now >= r.endsAt) {
      results.push(await finalizeRaid(r, r.t, false, now));
    }
  }
  return results;
}

// ── Saldırıyı çöz ve sonuçları uygula ──
export async function finalizeRaid(raid, defenderId, defendActive, now) {
  const A = await getUser(raid.a);
  const T = await getUser(raid.t);
  await clearActiveRaid(raid.t);
  await bumpCounter('war');
  if (!A || !T || A.banned) return { note: 'iptal' };

  collect(A); collect(T);
  const r = resolveRaid(A, T, defendActive, now);

  // Koalisyon kontrolü (aynı hedefe son 10 dk içinde başka saldırgan var mı?)
  const raiders = await recentRaiders(raid.t, 10 * 60 * 1000, now);
  const coal = coalitionBonus(A, raiders.length + 1); // kendisi dahil

  // Karşılıklı saldırı cezası (T→A saldırısı son 10 dk içinde var mı?)
  let mutual = null;
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

  // 🌍 Dünya olay akışı (herkesin Savaş sekmesinde canlı görünür)
  if (r.winner === 'A') {
    await addEvent({ type: 'raid', emoji: '💥', txt: `${raid.aName} ${raid.name}'in kovanını yağmaladı! (+${fmtTg(r.stolen)} 🍯)` });
  } else if (r.winner === 'T') {
    await addEvent({ type: 'def', emoji: '🛡️', txt: `${raid.name}, ${raid.aName}'in saldırısını püskürttü!` });
  } else {
    await addEvent({ type: 'draw', emoji: '🤝', txt: `${raid.aName} ile ${raid.name} savaşta berabere kaldı!` });
  }

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

export function escTg(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function fmtTg(n) {
  n = Math.floor(n || 0);
  return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
}
