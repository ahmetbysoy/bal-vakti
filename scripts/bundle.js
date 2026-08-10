// 📦 Bal Vakti — Vercel monolitik API üretici
// shared/* + shared/lib/* kodlarını TEK DOSYAYA (api/index.js) birleştirir.
// Neden: Vercel'in ESM projelerde yerel dosya paylaşımı kırık (ERR_MODULE_NOT_FOUND);
// tek dosyalık fonksiyonda hiçbir yerel import yok → %100 çalışır.
// Kullanım: node scripts/bundle.js   (kod değişince TEKRAR çalıştır + commit)
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// shared/lib modüllerini (sıralı) ve endpoint'leri derle
const LIB_ORDER = ['game.js', 'db.js', 'auth.js', 'raidcore.js', 'brain.js'];
const HANDLERS = [
  ['me', 'me.js'],
  ['action', 'action.js'],
  ['raid', 'raid.js'],
  ['admin', 'admin.js'],
  ['leaderboard', 'leaderboard.js'],
  ['bot', 'bot.js'],
];

const nodeImports = new Set();
const nodeImportLines = [];

function stripExports(src) {
  // export function/async function/const → düz tanım
  return src
    .replace(/^export\s+(async\s+function|function|const|let|class)\s+/gm, '$1 ')
    .replace(/^export\s+\{\s*([^}]+)\s*\};\s*$/gm, '') // export { a, b } blokları
    .replace(/^export\s+default\s+/gm, '');
}

// './lib/x.js' veya './x.js' (lib içi) importlarını scope'a bağla
function rewriteLocalImports(src, ns) {
  return src.replace(
    /import\s*\{([^}]+)\}\s*from\s*'\.\/(?:lib\/)?([a-z]+)\.js';/g,
    (m, names, mod) => `const { ${names.replace(/\s+/g, ' ').trim()} } = ${ns}['${mod}'];`
  );
}

// node-module importlarını ayır (bundle üstüne taşınır)
function extractNodeImports(src) {
  const lines = src.split('\n');
  const kept = [];
  for (const line of lines) {
    const m = line.match(/^import\s+(.+)\s+from\s+'([^'.][^']*)';/);
    if (m && !m[2].startsWith('./')) {
      if (!nodeImports.has(m[0])) {
        nodeImports.add(m[0]);
        nodeImportLines.push(m[0]);
      }
    } else {
      kept.push(line);
    }
  }
  return kept.join('\n');
}

function wrapModule(name, src) {
  let body = stripExports(src);
  body = rewriteLocalImports(body, '__lib');
  body = extractNodeImports(body);
  return `__lib['${name}'] = (() => {\n${body}\nreturn {${collectExports(src)}};\n})();`;
}

function collectExports(src) {
  const names = [];
  const re1 = /^export\s+(?:async\s+function|function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re1.exec(src))) names.push(m[1]);
  const re2 = /^export\s+\{\s*([^}]+)\s*\};/gm;
  while ((m = re2.exec(src))) {
    m[1].split(',').forEach((x) => {
      const nm = x.trim().split(/\s+as\s+/)[0].trim();
      if (nm) names.push(nm);
    });
  }
  return [...new Set(names)].join(', ');
}

function wrapHandler(name, src) {
  let body = stripExports(src);
  body = rewriteLocalImports(body, '__lib');
  body = extractNodeImports(body);
  return `__handlers['${name}'] = (() => {\n${body}\nreturn handler;\n})();`;
}

function build() {
  let out = `// 🐝 Bal Vakti — TEK DOSYALIK API (otomatik üretildi: node scripts/bundle.js)\n// Kaynak: shared/* ve shared/lib/* — lütfen bu dosyayı elle değiştirme!\n\n`;

  const libCode = {};
  for (const f of LIB_ORDER) {
    libCode[f.replace('.js', '')] = readFileSync(path.join(ROOT, 'shared/lib', f), 'utf8');
  }
  const handlerCode = {};
  for (const [name, f] of HANDLERS) {
    handlerCode[name] = readFileSync(path.join(ROOT, 'shared', f), 'utf8');
  }

  // 1) Tüm node-module importları üstte
  for (const f of [...Object.values(libCode), ...Object.values(handlerCode)]) {
    extractNodeImports(f);
  }
  out += [...nodeImportLines].join('\n') + '\n\n';

  // 2) Lib modülleri (sıralı)
  out += `const __lib = {};\n`;
  for (const f of LIB_ORDER) {
    const name = f.replace('.js', '');
    out += wrapModule(name, libCode[name]) + '\n';
  }

  // 3) Handler'lar
  out += `\nconst __handlers = {};\n`;
  for (const [name, f] of HANDLERS) {
    out += wrapHandler(name, handlerCode[name]) + '\n';
  }

  // 4) Router
  out += `
// ── Router ──
const ROUTES = {
  '/api/me': __handlers.me,
  '/api/action': __handlers.action,
  '/api/raid': __handlers.raid,
  '/api/admin': __handlers.admin,
  '/api/leaderboard': __handlers.leaderboard,
  '/api/bot': __handlers.bot,
};

export default async function handler(req, res) {
  const pathname = (req.url || '/').split('?')[0];
  const fn = ROUTES[pathname];
  if (!fn) {
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ error: 'yok' }));
  }
  try {
    await fn(req, res);
  } catch (e) {
    console.error('router hatası:', e);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'sunucu_hatasi', detail: String(e?.message || e) }));
    }
  }
}
`;

  mkdirSync(path.join(ROOT, 'api'), { recursive: true });
  writeFileSync(path.join(ROOT, 'api/index.js'), out);
  console.log('✅ api/index.js üretildi (' + (out.length / 1024).toFixed(1) + ' KB)');
}

build();
