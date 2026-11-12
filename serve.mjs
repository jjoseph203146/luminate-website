import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const ROOT = process.cwd();
const PORT = 3000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};

function insideRoot(file) {
  const root = ROOT.endsWith(sep) ? ROOT : ROOT + sep;
  return file === ROOT || file.startsWith(root);
}

async function isFile(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

/** Mirror the static routes Vercel serves: a path, path.html, or path/index.html. */
async function resolve(urlPath) {
  let path = decodeURIComponent(urlPath.split('?')[0]);
  if (path.includes('\0')) return null;
  const rel = normalize(path).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  const base = join(ROOT, rel);
  if (!insideRoot(base) && base !== ROOT) return null;
  const candidates = path.endsWith('/')
    ? [join(base, 'index.html')]
    : [base, base + '.html', join(base, 'index.html')];
  for (const file of candidates) {
    if (insideRoot(file) && await isFile(file)) return file;
  }
  return null;
}

createServer(async (req, res) => {
  try {
    const file = await resolve(req.url || '/');
    if (!file) {
      const notFound = join(ROOT, '404.html');
      if (await isFile(notFound)) {
        const data = await readFile(notFound);
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500');
  }
}).listen(PORT, () => console.log(`Serving ${ROOT} at http://localhost:${PORT}`));
