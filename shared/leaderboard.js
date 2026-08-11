// 🏆 GET /api/leaderboard — en iyi 30 arıcı
// mode=today → bugünün kazançları · mode=week → haftalık · mode=cnt → dünya sayaçları
import { topLb, topToday, topWeekly, getCounters } from './lib/db.js';

export async function route(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET bekleniyor' });
  const mode = new URL(req.url, 'http://x').searchParams.get('mode') || 'all';
  if (mode === 'today') {
    const top = await topToday(10);
    return res.json({ ok: true, top });
  }
  if (mode === 'week') {
    const top = await topWeekly(10);
    return res.json({ ok: true, top });
  }
  if (mode === 'cnt') {
    const c = await getCounters();
    const wk = await topWeekly(10);
    const weekTotal = wk.reduce((a, x) => a + x.score, 0);
    return res.json({ ok: true, warCount: c.war || 0, spinCount: c.spin || 0, weekTotal });
  }
  const top = await topLb(30);
  res.json({ ok: true, top });
}
