import { readFile, writeFile, mkdtemp, rm, access } from 'node:fs/promises';
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
const HLJS_CSS = fileURLToPath(import.meta.resolve('highlight.js/styles/github.css'));
/** katex.min.css 와 fonts/ 가 들어있는 폴더 */
export const KATEX_DIR = path.dirname(fileURLToPath(import.meta.resolve('katex')));

export const PAPER_SIZES = ['A4', 'A3', 'A5', 'Letter', 'Legal'];
const MARGIN = { top: '20mm', bottom: '20mm', left: '10mm', right: '10mm' };

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

/** 테마 이름 검증 후 CSS 로드 (경로 조작 방지) */
async function loadTheme(theme) {
  const badRequest = (msg) => Object.assign(new Error(msg), { status: 400 });
  if (!/^[\w-]+$/.test(theme)) throw badRequest(`잘못된 테마 이름: ${theme}`);
  const file = path.join(THEMES_DIR, `${theme}.css`);
  try {
    await access(file);
  } catch {
    throw badRequest(`테마를 찾을 수 없습니다: ${theme}`);
  }
  return readFile(file, 'utf8');
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
  const [themeCss, hljsCss] = await Promise.all([loadTheme(theme), readFile(HLJS_CSS, 'utf8')]);

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
${baseHref ? `<base href="${escapeHtml(baseHref)}">` : ''}
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${escapeHtml(katexHref)}/katex.min.css">
<style>${hljsCss}</style>
<style>${themeCss}</style>
${extraCss ? `<style>${extraCss}</style>` : ''}
</head>
<body><article class="markdown-body">${body}</article></body>
</html>`;
}

function headerFooter(title) {
  const style = "font-family:'Malgun Gothic','Noto Sans KR',sans-serif;font-size:8pt;color:#8c959f;width:100%;padding:0 10mm;";
  return {
    displayHeaderFooter: true,
    headerTemplate: `<div style="${style}text-align:right;">${escapeHtml(title)}</div>`,
    footerTemplate: `<div style="${style}text-align:center;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
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
    await page.evaluate(() => document.fonts.ready);
    return await page.pdf({
      path: outputPath,
      format: paper,
      printBackground: true,
      margin: MARGIN,
      ...(showHeaderFooter ? headerFooter(title) : {}),
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
