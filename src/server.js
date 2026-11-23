#!/usr/bin/env node
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderHtml, printPdf, launchBrowser, KATEX_DIR, PAPER_SIZES } from './converter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, 'web');
const SAMPLE_MD = path.join(__dirname, '..', 'samples', 'sample.md');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 3000;
const ORIGIN = `http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`;
const MAX_BODY = 10 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

// 미리보기를 "종이"처럼 보이게: A4 인쇄 폭(210mm - 좌우 여백 30mm)
const PREVIEW_CSS = `body { max-width: 180mm; margin: 0 auto; padding: 40px 24px 80px; }`;

let browserPromise;
function getBrowser() {
  browserPromise ??= launchBrowser().catch((err) => {
    browserPromise = undefined;
    throw err;
  });
  return browserPromise;
}

function send(res, status, body, type = 'text/plain; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'Content-Type': type, ...headers });
  res.end(body);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('요청이 너무 큽니다 (최대 10MB)'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('잘못된 JSON'), { status: 400 });
  }
}

/** 루트 폴더 밖으로 나가지 않는 정적 파일 제공 */
async function serveStatic(res, root, rel) {
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep)) return send(res, 403, 'Forbidden');
  try {
    const data = await readFile(file);
    send(res, 200, data, MIME[path.extname(file)] ?? 'application/octet-stream', {
      'Cache-Control': 'public, max-age=3600',
      // PDF 생성 페이지(about:blank)에서 웹폰트를 불러오려면 CORS 필요
      'Access-Control-Allow-Origin': '*',
    });
  } catch {
    send(res, 404, 'Not Found');
  }
}

function docOptions(body, extra = {}) {
  return {
    theme: body.theme || 'github',
    title: body.title || 'document',
    baseHref: ORIGIN + '/',
    katexHref: ORIGIN + '/assets/katex',
    ...extra,
  };
}

async function handle(req, res) {
  const url = new URL(req.url, ORIGIN);
  const p = decodeURIComponent(url.pathname);

  if (req.method === 'GET') {
    if (p === '/' || p === '/index.html') return serveStatic(res, WEB_DIR, 'index.html');
    if (p === '/favicon.ico') return send(res, 204, '');
    if (p.startsWith('/assets/katex/')) return serveStatic(res, KATEX_DIR, p.slice('/assets/katex/'.length));
    if (p.startsWith('/web/')) return serveStatic(res, WEB_DIR, p.slice('/web/'.length));
    if (p === '/api/sample') return send(res, 200, await readFile(SAMPLE_MD, 'utf8'));
    if (p === '/api/config') return send(res, 200, JSON.stringify({ paperSizes: PAPER_SIZES }), 'application/json');
    return send(res, 404, 'Not Found');
  }

  if (req.method === 'POST' && p === '/api/render') {
    const body = await readJson(req);
    const html = await renderHtml(String(body.markdown ?? ''), docOptions(body, { extraCss: PREVIEW_CSS }));
    return send(res, 200, html, 'text/html; charset=utf-8');
  }

  if (req.method === 'POST' && p === '/api/pdf') {
    const body = await readJson(req);
    const opts = docOptions(body);
    const html = await renderHtml(String(body.markdown ?? ''), opts);
    const pdf = await printPdf(await getBrowser(), { html }, {
      paper: body.paper || 'A4',
      title: opts.title,
      showHeaderFooter: body.headerFooter !== false,
    });
    const filename = `${opts.title}.pdf`;
    return send(res, 200, Buffer.from(pdf), 'application/pdf', {
      'Content-Disposition': `attachment; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    });
  }

  send(res, 405, 'Method Not Allowed');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) send(res, err.status ?? 500, err.message);
    else res.end();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`md2pdf 웹 뷰어: ${ORIGIN}`);
  console.log('종료: Ctrl+C');
});

async function shutdown() {
  server.close();
  if (browserPromise) await (await browserPromise.catch(() => null))?.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
