#!/usr/bin/env node
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderHtml, printPdf, launchBrowser, listThemes, KATEX_DIR, PAPER_SIZES } from './converter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, 'web');
const SAMPLES_DIR = path.join(__dirname, '..', 'samples');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 3000;
const ORIGIN = `http://localhost:${PORT}`;
const MAX_JSON = 10 * 1024 * 1024;

// 업로드 이미지 저장소 (메모리)
const MAX_FILE = 30 * 1024 * 1024;
const MAX_SESSION_BYTES = 300 * 1024 * 1024;
const MAX_SESSIONS = 5;
const SID_RE = /^[0-9a-f-]{36}$/;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.ico', '.svg']);

// 미리보기는 창 폭을 넉넉하게 사용 (너무 넓은 화면에서만 상한)
const PREVIEW_CSS = `body { max-width: 1400px; margin: 0 auto; padding: 24px 32px 80px; }`;

/* ---------- 브라우저 (PDF용, 재사용) ---------- */
let browserPromise;
function getBrowser() {
  browserPromise ??= launchBrowser().catch((err) => {
    browserPromise = undefined;
    throw err;
  });
  return browserPromise;
}

/* ---------- 이미지 세션 저장소 ---------- */
/** sid → { files: Map<key, {type, data}>, bytes, touched } */
const sessions = new Map();

/** Windows처럼 대소문자 구분 없이, 경로 구분자 통일 */
function fileKey(rel) {
  return rel.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

function getSession(sid, create = false) {
  let s = sessions.get(sid);
  if (!s && create) {
    s = { files: new Map(), bytes: 0, touched: Date.now() };
    sessions.set(sid, s);
    // 오래된 세션부터 정리
    while (sessions.size > MAX_SESSIONS) {
      const oldest = [...sessions.entries()].sort((a, b) => a[1].touched - b[1].touched)[0][0];
      sessions.delete(oldest);
    }
  }
  if (s) s.touched = Date.now();
  return s;
}

/* ---------- 공통 ---------- */
function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function send(res, status, body, type = 'text/plain; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(body);
}

async function readBody(req, limit) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw httpError(413, `요청이 너무 큽니다 (최대 ${Math.round(limit / 1024 / 1024)}MB)`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  try {
    return JSON.parse((await readBody(req, MAX_JSON)).toString('utf8'));
  } catch (err) {
    throw err.status ? err : httpError(400, '잘못된 JSON');
  }
}

const STATIC_HEADERS = {
  'Cache-Control': 'no-cache',
  // PDF 생성 페이지(about:blank)에서 웹폰트를 불러오려면 CORS 필요
  'Access-Control-Allow-Origin': '*',
};
// 업로드된 파일(특히 SVG)을 직접 열어도 스크립트가 실행되지 않게
const UPLOAD_HEADERS = { ...STATIC_HEADERS, 'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'" };

/** 루트 폴더 밖으로 나가지 않는 정적 파일 제공 */
async function serveStatic(res, root, rel, extraHeaders = {}) {
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep)) return send(res, 403, 'Forbidden');
  try {
    const data = await readFile(file);
    send(res, 200, data, MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', { ...STATIC_HEADERS, ...extraHeaders });
  } catch {
    send(res, 404, 'Not Found');
  }
}

/**
 * 클라이언트가 보낸 문서 기준 경로 → 절대 base URL
 *  '/samples/'            : 샘플 폴더
 *  '/s/<sid>/<dir>/'      : 업로드한 폴더 안의 .md 위치
 */
function resolveBase(base) {
  if (typeof base !== 'string' || base === '') return ORIGIN + '/';
  if (base === '/samples/' || /^\/s\/[0-9a-f-]{36}\/([^?#]*\/)?$/.test(base)) return ORIGIN + base;
  throw httpError(400, '잘못된 base 경로');
}

function docOptions(body, extra = {}) {
  return {
    theme: body.theme || 'github',
    title: body.title || 'document',
    baseHref: resolveBase(body.base),
    katexHref: ORIGIN + '/assets/katex',
    ...extra,
  };
}

/* ---------- 라우팅 ---------- */
async function handle(req, res) {
  const url = new URL(req.url, ORIGIN);
  let p;
  try {
    p = decodeURIComponent(url.pathname);
  } catch {
    return send(res, 400, 'Bad Request');
  }

  // 업로드 이미지: /s/<sid>/<상대경로>
  const sm = p.match(/^\/s\/([^/]+)\/(.+)$/);
  if (sm && req.method === 'GET') {
    const s = SID_RE.test(sm[1]) && getSession(sm[1]);
    const f = s && s.files.get(fileKey(sm[2]));
    if (!f) return send(res, 404, 'Not Found', undefined, STATIC_HEADERS);
    return send(res, 200, f.data, f.type, UPLOAD_HEADERS);
  }

  // 이미지 업로드: PUT /api/s/<sid>/f/<상대경로>
  const um = p.match(/^\/api\/s\/([^/]+)\/f\/(.+)$/);
  if (um && req.method === 'PUT') {
    if (!SID_RE.test(um[1])) throw httpError(400, '잘못된 세션');
    const ext = path.extname(um[2]).toLowerCase();
    if (!IMAGE_EXT.has(ext)) throw httpError(415, `이미지 파일만 올릴 수 있습니다: ${um[2]}`);
    const data = await readBody(req, MAX_FILE);
    const s = getSession(um[1], true);
    const key = fileKey(um[2]);
    const prev = s.files.get(key);
    const bytes = s.bytes - (prev?.data.length ?? 0) + data.length;
    if (bytes > MAX_SESSION_BYTES) throw httpError(413, '이미지 총 용량이 너무 큽니다 (최대 300MB)');
    s.files.set(key, { type: MIME[ext], data });
    s.bytes = bytes;
    return send(res, 204, '');
  }

  // 세션 상태 확인: GET /api/s/<sid>
  const cm = p.match(/^\/api\/s\/([^/]+)$/);
  if (cm && req.method === 'GET') {
    const s = SID_RE.test(cm[1]) && getSession(cm[1]);
    return send(res, s ? 200 : 404, JSON.stringify({ files: s ? s.files.size : 0 }), 'application/json');
  }

  if (req.method === 'GET') {
    if (p === '/' || p === '/index.html') return serveStatic(res, WEB_DIR, 'index.html');
    if (p === '/favicon.ico' || p === '/favicon.svg') return serveStatic(res, WEB_DIR, 'favicon.svg');
    if (p.startsWith('/assets/katex/')) return serveStatic(res, KATEX_DIR, p.slice('/assets/katex/'.length));
    if (p.startsWith('/samples/')) return serveStatic(res, SAMPLES_DIR, p.slice('/samples/'.length), UPLOAD_HEADERS);
    if (p === '/api/sample') return send(res, 200, await readFile(path.join(SAMPLES_DIR, 'sample.md'), 'utf8'));
    if (p === '/api/config') return send(res, 200, JSON.stringify({ paperSizes: PAPER_SIZES, themes: await listThemes() }), 'application/json');
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
    if (!err.status) console.error(err);
    if (!res.headersSent) send(res, err.status ?? 500, err.message);
    else res.end();
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`포트 ${PORT}을(를) 이미 사용 중입니다. 웹 뷰어가 이미 켜져 있거나, 다른 포트를 쓰세요 (예: set PORT=8080).`);
  } else {
    console.error(err);
  }
  process.exit(1);
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
