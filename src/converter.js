import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import puppeteer from 'puppeteer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THEMES_DIR = path.join(__dirname, 'themes');
const HLJS_CSS = fileURLToPath(import.meta.resolve('highlight.js/styles/github.css'));

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
);

/** Markdown 문자열 → 완성된 HTML 문서 */
export async function renderHtml(markdown, { theme = 'github', baseDir = process.cwd(), title = 'document' } = {}) {
  const body = await marked.parse(markdown);
  const themeCss = await readFile(path.join(THEMES_DIR, `${theme}.css`), 'utf8');
  const hljsCss = await readFile(HLJS_CSS, 'utf8');
  // <base>로 상대경로 이미지(로컬 파일)를 md 파일 위치 기준으로 해석
  const baseHref = pathToFileURL(baseDir + path.sep).href;

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<base href="${baseHref}">
<title>${title}</title>
<style>${hljsCss}</style>
<style>${themeCss}</style>
</head>
<body><article class="markdown-body">${body}</article></body>
</html>`;
}

/** .md 파일 → .pdf 파일 */
export async function convertFile(inputPath, outputPath, { theme = 'github', paper = 'A4' } = {}) {
  const absInput = path.resolve(inputPath);
  const markdown = await readFile(absInput, 'utf8');
  const html = await renderHtml(markdown, {
    theme,
    baseDir: path.dirname(absInput),
    title: path.basename(absInput, path.extname(absInput)),
  });

  const browser = await puppeteer.launch({ args: ['--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({
      path: path.resolve(outputPath),
      format: paper,
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
    });
  } finally {
    await browser.close();
  }
  return path.resolve(outputPath);
}
