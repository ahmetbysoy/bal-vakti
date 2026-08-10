// 🔬 TEŞHİS UÇU — Vercel'in sunucusunda gerçekte hangi dosyalar var?
// Kullanım: GET https://<app>/api/debug
// Bağımlılık YOK (sadece node built-in) — her ortamda çalışır.
import { readdirSync, statSync } from 'fs';

export default async function handler(req, res) {
  const out = { ok: true, cwd: process.cwd(), appDir: '/var/task', files: [] };
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      if (e === 'node_modules' || e === '.next') continue;
      const full = `${dir}/${e}`;
      let isDir = false;
      try { isDir = statSync(full).isDirectory(); } catch { continue; }
      out.files.push({ p: full, d: isDir });
      if (isDir) walk(full, depth + 1);
    }
  };
  walk(process.cwd(), 0);
  walk('/var/task', 0);
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(out, null, 1));
}
