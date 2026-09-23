// Test server for the manual/e2e test page. Listens on loopback only.
// Usage: npm run testpage [-- --port 8765]
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: { port: { type: 'string', default: '8765' } },
});
const PORT = Number(values.port);
const here = (path) => new URL(path, import.meta.url);

const IMAGE = await readFile(here('../public/icons/128.png'));
const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @type {Record<string, (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => unknown>} */
const routes = {
  '/': async (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(await readFile(here('index.html')));
  },
  '/frame.html': async (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(await readFile(here('frame.html')));
  },
  '/image.png': (_req, res) => {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(IMAGE);
  },
  '/not-an-image': (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('secret text that must not reach the page\n');
  },
  '/redirect': (_req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${PORT}/image.png` });
    res.end();
  },
  '/slow.png': async (_req, res) => {
    res.writeHead(200, {
      'content-type': 'image/png',
      'content-length': IMAGE.length,
    });
    const step = Math.ceil(IMAGE.length / 20);
    for (let offset = 0; offset < IMAGE.length; offset += step) {
      res.write(IMAGE.subarray(offset, offset + step));
      await sleep(150);
    }
    res.end();
  },
  '/too-large.png': (_req, res) => {
    res.writeHead(200, {
      'content-type': 'image/png',
      'content-length': MAX_DOWNLOAD_BYTES + 1,
    });
    res.end();
  },
  '/disposition.png': (_req, res) => {
    // U+202E makes "photo<RLO>gnp.exe" read as "photoexe.png".
    res.writeHead(200, {
      'content-type': 'image/png',
      'content-disposition': `attachment; filename*=UTF-8''photo%E2%80%AEgnp.exe`,
    });
    res.end(IMAGE);
  },
};

async function handle(req, res) {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  const route = routes[path];
  console.log(
    `${new Date().toLocaleTimeString()}  ${req.method} ${req.headers.host}${path}`,
  );
  if (!route) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found\n');
    return;
  }
  try {
    await route(req, res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
}

for (const host of ['127.0.0.1', '::1']) {
  createServer(handle)
    .on('error', (error) => {
      if (host === '::1') return;
      console.error(error.message);
      process.exit(1);
    })
    .listen(PORT, host);
}

console.log(`FIOverlay test page: http://localhost:${PORT}/`);
console.log('Requests are logged below; a blocked download never shows up.');
