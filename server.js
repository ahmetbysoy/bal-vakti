// 🚀 Bal Vakti — yerel geliştirme sunucusu
// Vercel'e deploy etmeden önce: npm start → http://localhost:8787
// Aynı API fonksiyonlarını çalıştırır (api/*.js), static index.html'i sunar.
import http from 'http';
import { readFileSync, existsSync, watch } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dbMode } from './shared/lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8787;

// Yerel test kolaylığı: demo modu varsayılan açık
if (!process.env.ALLOW_DEMO) process.env.ALLOW_DEMO = '1';

async function handleApi(req, res, seg) {
  // Vercel uyumluluk katmanı: res.json() ve res.status() desteği
  res.json = (obj) => {
    if (!res.headersSent) {
      res.writeHead(res.statusCode || 200, { 'content-type': 'application/json; charset=utf-8' });
    }
    res.end(JSON.stringify(obj));
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  try {
    const mod = await import(`./shared/${seg}.js`);
    let body = null;
    if (req.method === 'POST' || req.method === 'PUT') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw) {
        try { body = JSON.parse(raw); } catch { body = {}; }
      }
    }
    req.body = body || {};
    await (mod.default || mod.route)(req, res);
  } catch (e) {
    console.error(`API hatası /api/${seg}:`, e);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'sunucu_hatasi', detail: String(e) }));
    }
  }
}

// ── 🔄 LIVERELOAD (dev): index.html değişince tarayıcı otomatik yenilenir ──
const liveClients = new Set();
if (process.env.LIVERELOAD !== '0') {
  watch('index.html', () => {
    const msg = 'data: reload\n\n';
    for (const c of liveClients) { try { c.write(msg); } catch (e) {} }
  });
  console.log('   🔄 Livereload aktif — index.html kaydedince otomatik yenilenir');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/__livereload') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(': connected\n\n');
    liveClients.add(res);
    req.on('close', () => liveClients.delete(res));
    return;
  }
  if (url.pathname === '/api/me' || url.pathname === '/api/action' || url.pathname === '/api/leaderboard' || url.pathname === '/api/bot' || url.pathname === '/api/admin' || url.pathname === '/api/raid') {
    return handleApi(req, res, url.pathname.split('/')[2]);
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const file = path.join(__dirname, 'index.html');
    if (existsSync(file)) {
      let html = readFileSync(file, 'utf8');
      // 🔄 Dev'de livereload scripti inject et (production'a asla girmez)
      if (process.env.LIVERELOAD !== '0') {
        html = html.replace('</body>',
          '<script>new EventSource(\'/__livereload\').onmessage=function(){location.reload()}</script></body>');
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
  }
  if (url.pathname === '/admin.html') {
    const file = path.join(__dirname, 'admin.html');
    if (existsSync(file)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(readFileSync(file));
    }
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Bulunamadı 🐝');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🐝 Bal Vakti yerel sunucu: http://localhost:${PORT}`);
  console.log(`   DB modu: ${dbMode()}`);
});
