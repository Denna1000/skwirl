// Lokale server voor dist/ (alleen voor ontwikkelen).
// Met MOCK_DATA=<map> doet /__mock/ zich voor als de GitHub Contents API, met de JSON-bestanden uit die map in het geheugen.
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join, normalize } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.map': 'application/json' };
const port = Number(process.env.PORT ?? 5173);
const mock = new Map();
const sha = (s) => createHash('sha1').update(s).digest('hex');
if (process.env.MOCK_DATA) {
  for (const f of await readdir(process.env.MOCK_DATA)) if (f.endsWith('.json')) { const c = await readFile(join(process.env.MOCK_DATA, f), 'utf8'); mock.set(f, { content: c, sha: sha(c) }); }
}
const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => ok(b)); });

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname.startsWith('/__mock/')) {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,PUT', 'Access-Control-Expose-Headers': 'etag' };
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
    const m = url.pathname.match(/^\/__mock\/repos\/[^/]+\/[^/]+(?:\/contents\/(.+))?$/);
    if (!m) return res.writeHead(404, cors).end();
    if (!m[1]) return res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify({ private: true, permissions: { push: true } }));
    const file = decodeURIComponent(m[1]);
    if (req.method === 'GET') {
      const f = mock.get(file);
      if (!f) return res.writeHead(404, cors).end('{}');
      if (req.headers['if-none-match'] === `"${f.sha}"`) return res.writeHead(304, cors).end();
      return res.writeHead(200, { ...cors, 'Content-Type': 'application/json', etag: `"${f.sha}"` }).end(JSON.stringify({ sha: f.sha, content: Buffer.from(f.content).toString('base64') }));
    }
    const body = JSON.parse(await readBody(req));
    const cur = mock.get(file);
    if ((cur && body.sha !== cur.sha) || (!cur && body.sha)) return res.writeHead(409, cors).end('{}');
    const content = Buffer.from(body.content, 'base64').toString('utf8');
    const next = { content, sha: sha(content) }; mock.set(file, next);
    return res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify({ content: { sha: next.sha } }));
  }
  const path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join('dist', path.endsWith('/') ? path + 'index.html' : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Niet gevonden');
  }
}).listen(port, '127.0.0.1', () => console.log(`Skwirl draait op http://127.0.0.1:${port}/${mock.size ? ` (nep-GitHub met ${mock.size} bestanden)` : ''}`));
