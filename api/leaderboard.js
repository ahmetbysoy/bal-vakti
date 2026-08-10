// 🏆 GET /api/leaderboard — en iyi 30 arıcı
import { topLb } from '../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET bekleniyor' });
  const top = await topLb(30);
  res.json({ ok: true, top });
}
