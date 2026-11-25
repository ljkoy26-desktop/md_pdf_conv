import { readFile, writeFile, mkdtemp, rm, access, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import markedKatex from 'marked-katex-extension';
import hljs from 'highlight.js';
import puppeteer from 'puppeteer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THEMES_DIR = path.join(__dirname, 'themes');
const HLJS_STYLES_DIR = path.dirname(fileURLToPath(import.meta.resolve('highlight.js/styles/github.css')));
/** katex.min.css 와 fonts/ 가 들어있는 폴더 */
export const KATEX_DIR = path.dirname(fileURLToPath(import.meta.resolve('katex')));

export const PAPER_SIZES = ['A4', 'A3', 'A5', 'Letter', 'Legal'];
// 위·아래 여백은 머리글/쪽번호 영역, 좌우 여백은 본문 padding 으로 처리
// (Chrome은 PDF 여백에 배경을 칠하지 않으므로, 어두운 테마도 여백까지 같은 색이 되도록)
const MARGIN_Y = '20mm';
const MARGIN_X = '10mm';

const marked = new Marked(
  { gfm: true },
  markedHighlight({
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    },
  }),
  // $인라인$ , $$블록$$ 수식
  markedKatex({ throwOnError: false, nonStandard: true }),
);

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * 테마 파일 머리 주석의 메타데이터
 *   @label 표시 이름
 *   @hljs  코드 하이라이트 스타일 (highlight.js/styles/<이름>.css)
 */
function parseThemeMeta(id, css) {
  const label = css.match(/@label\s+(.+)/)?.[1].trim() || id;
  const hljsName = css.match(/@hljs\s+([\w-]+)/)?.[1] || 'github';
  return { id, label, hljs: hljsName };
}

/** 사용 가능한 테마 목록 (_로 시작하는 파일은 공통 CSS라 제외) */
export async function listThemes() {
  const files = (await readdir(THEMES_DIR)).filter((f) => f.endsWith('.css') && !f.startsWith('_')).sort();
  const themes = await Promise.all(
    files.map(async (f) => parseThemeMeta(path.basename(f, '.css'), await readFile(path.join(THEMES_DIR, f), 'utf8'))),
  );
  // 기본 테마를 맨 앞에
  return themes.sort((a, b) => (b.id === 'github') - (a.id === 'github'));
}

/** 테마 이름 검증 후 CSS 로드 (경로 조작 방지) → 공통 CSS + 테마 CSS + 하이라이트 CSS */
async function loadTheme(theme) {
  const badRequest = (msg) => Object.assign(new Error(msg), { status: 400 });
  if (!/^[a-z0-9][\w-]*$/i.test(theme)) throw badRequest(`잘못된 테마 이름: ${theme}`);
  const file = path.join(THEMES_DIR, `${theme}.css`);
  try {
    await access(file);
  } catch {
    throw badRequest(`테마를 찾을 수 없습니다: ${theme}`);
  }
  const themeCss = await readFile(file, 'utf8');
  const meta = parseThemeMeta(theme, themeCss);
  let hljsCss;
  try {
    hljsCss = await readFile(path.join(HLJS_STYLES_DIR, `${meta.hljs}.css`), 'utf8');
  } catch {
    hljsCss = await readFile(path.join(HLJS_STYLES_DIR, 'github.css'), 'utf8');
  }
  const baseCss = await readFile(path.join(THEMES_DIR, '_base.css'), 'utf8');
  return { baseCss, themeCss, hljsCss };
}

/**
 * Markdown 문자열 → 완성된 HTML 문서
 * @param {object} o
 * @param {string} o.baseHref   상대 경로(이미지 등)의 기준 URL
 * @param {string} o.katexHref  KaTeX 폴더 URL (katex.min.css + fonts/)
 * @param {string} [o.extraCss] 추가 CSS (웹 미리보기용 등)
 */
export async function renderHtml(markdown, { theme = 'github', baseHref, katexHref, title = 'document', extraCss = '' }) {
  const body = await marked.parse(markdown);
  const { baseCss, themeCss, hljsCss } = await loadTheme(theme);

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
${baseHref ? `<base href="${escapeHtml(baseHref)}">` : ''}
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${escapeHtml(katexHref)}/katex.min.css">
<style>${hljsCss}</style>
<style>${baseCss}</style>
<style>${themeCss}</style>
${extraCss ? `<style>${extraCss}</style>` : ''}
</head>
<body><article class="markdown-body">${body}</article></body>
</html>`;
}

/** 머리글/바닥글: 테마 배경으로 위·아래 여백을 채우고, 켜져 있으면 제목·쪽번호 표시 */
function headerFooter(title, show, { bg, muted }) {
  const color = (v, fallback) => (/^[#\w(),.\s%-]+$/.test(v) ? v : fallback);
  const box = (align, content) =>
    `<style>#header,#footer{padding:0!important;}</style>` +
    `<div style="-webkit-print-color-adjust:exact;box-sizing:border-box;width:100%;height:${MARGIN_Y};` +
    `margin:0;padding:0 ${MARGIN_X};display:flex;align-items:center;justify-content:${align};` +
    `background:${color(bg, '#fff')};color:${color(muted, '#8c959f')};` +
    `font-family:'Malgun Gothic','Noto Sans KR',sans-serif;font-size:8pt;"><span>${show ? content : ''}</span></div>`;
  return {
    displayHeaderFooter: true,
    headerTemplate: box('flex-end', escapeHtml(title)),
    footerTemplate: box('center', '<span class="pageNumber"></span> / <span class="totalPages"></span>'),
  };
}

/**
 * 열린 브라우저로 PDF 생성
 * @param {import('puppeteer').Browser} browser
 * @param {{html?: string, url?: string}} source  html 또는 url 중 하나
 * @returns {Promise<Uint8Array>}
 */
export async function printPdf(browser, source, { paper = 'A4', title = 'document', showHeaderFooter = true, outputPath } = {}) {
  if (!PAPER_SIZES.includes(paper)) {
    throw Object.assign(new Error(`지원하지 않는 용지 크기: ${paper} (${PAPER_SIZES.join(', ')})`), { status: 400 });
  }
  const page = await browser.newPage();
  try {
    if (source.url) await page.goto(source.url, { waitUntil: 'networkidle0' });
    else await page.setContent(source.html, { waitUntil: 'networkidle0' });
    await page.addStyleTag({ content: `body { padding: 0 ${MARGIN_X}; }` });
    await page.evaluate(() => document.fonts.ready);
    const colors = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return { bg: s.getPropertyValue('--bg').trim(), muted: s.getPropertyValue('--muted').trim() };
    });
    return await page.pdf({
      path: outputPath,
      format: paper,
      printBackground: true,
      margin: { top: MARGIN_Y, bottom: MARGIN_Y, left: 0, right: 0 },
      ...headerFooter(title, showHeaderFooter, colors),
    });
  } finally {
    await page.close();
  }
}

export function launchBrowser() {
  return puppeteer.launch();
}

/**
 * .md 파일 → .pdf 파일 (CLI용)
 * browser를 넘기면 재사용(일괄 변환), 없으면 새로 띄우고 닫음
 */
export async function convertFile(inputPath, outputPath, { theme = 'github', paper = 'A4', showHeaderFooter = true, browser } = {}) {
  const absInput = path.resolve(inputPath);
  const absOutput = path.resolve(outputPath);
  const title = path.basename(absInput, path.extname(absInput));
  const markdown = await readFile(absInput, 'utf8');
  const html = await renderHtml(markdown, {
    theme,
    title,
    baseHref: pathToFileURL(path.dirname(absInput) + path.sep).href,
    katexHref: pathToFileURL(KATEX_DIR).href,
  });

  // file:// 로 열어야 로컬 이미지·폰트가 로드됨 → 임시 HTML 파일 사용
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'md2pdf-'));
  const tmpHtml = path.join(tmpDir, 'index.html');
  await writeFile(tmpHtml, html, 'utf8');

  const ownBrowser = !browser;
  browser ??= await launchBrowser();
  try {
    await printPdf(browser, { url: pathToFileURL(tmpHtml).href }, { paper, title, showHeaderFooter, outputPath: absOutput });
  } finally {
    if (ownBrowser) await browser.close();
    await rm(tmpDir, { recursive: true, force: true });
  }
  return absOutput;
}
