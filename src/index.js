#!/usr/bin/env node
import { stat, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { convertFile, launchBrowser, PAPER_SIZES } from './converter.js';

const MD_EXT = new Set(['.md', '.markdown']);
const SKIP_DIRS = new Set(['node_modules', '.git']);

/** 폴더 안의 .md 파일 목록 (recursive면 하위 폴더 포함) */
async function findMarkdown(dir, recursive) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive && !SKIP_DIRS.has(entry.name)) out.push(...(await findMarkdown(full, true)));
    } else if (MD_EXT.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out.sort();
}

/** 인자(파일/폴더 혼합) → [{ file, root }] (root: 폴더 구조 유지용 기준 경로) */
async function collectInputs(inputs, recursive) {
  const files = [];
  const missing = [];
  for (const input of inputs) {
    let info;
    try {
      info = await stat(input);
    } catch {
      missing.push(input);
      continue;
    }
    if (info.isDirectory()) {
      const root = path.resolve(input);
      for (const file of await findMarkdown(root, recursive)) files.push({ file, root });
    } else {
      files.push({ file: path.resolve(input), root: path.dirname(path.resolve(input)) });
    }
  }
  // 같은 파일 중복 제거
  const seen = new Set();
  return { files: files.filter(({ file }) => !seen.has(file.toLowerCase()) && seen.add(file.toLowerCase())), missing };
}

function outputPathFor({ file, root }, opts) {
  const name = path.basename(file, path.extname(file)) + '.pdf';
  if (!opts.outDir) return path.join(path.dirname(file), name);
  // --out-dir: 입력 폴더 기준 하위 구조를 그대로 유지
  return path.join(path.resolve(opts.outDir), path.relative(root, path.dirname(file)), name);
}

const program = new Command();

program
  .name('md2pdf')
  .description('Markdown 파일을 PDF로 변환합니다 (파일·폴더 여러 개 가능)')
  .argument('<inputs...>', '.md 파일 또는 폴더 (여러 개 가능)')
  .option('-o, --output <file>', '출력 .pdf 파일 (입력이 파일 1개일 때만)')
  .option('-d, --out-dir <dir>', '모든 PDF를 저장할 폴더 (기본: 각 .md 옆)')
  .option('-r, --recursive', '폴더 입력 시 하위 폴더까지 포함')
  .option('-t, --theme <name>', '테마 (src/themes/<name>.css)', 'github')
  .option('-p, --paper <size>', `용지 크기 (${PAPER_SIZES.join(', ')})`, 'A4')
  .option('--no-header-footer', '머리글(제목)과 페이지 번호 끄기')
  .action(async (inputs, opts) => {
    if (!PAPER_SIZES.includes(opts.paper)) {
      console.error(`지원하지 않는 용지 크기: ${opts.paper} (${PAPER_SIZES.join(', ')})`);
      process.exit(1);
    }

    const { files, missing } = await collectInputs(inputs, opts.recursive);
    for (const m of missing) console.error(`찾을 수 없음: ${m}`);
    if (files.length === 0) {
      console.error('변환할 .md 파일이 없습니다.');
      process.exit(1);
    }
    if (opts.output && files.length > 1) {
      console.error('-o 는 파일 1개일 때만 쓸 수 있습니다. 여러 개는 -d <폴더> 를 사용하세요.');
      process.exit(1);
    }

    const browser = await launchBrowser();
    let ok = 0;
    const failed = [];
    try {
      for (const [i, item] of files.entries()) {
        const output = opts.output ?? outputPathFor(item, opts);
        const label = files.length > 1 ? `[${i + 1}/${files.length}] ` : '';
        try {
          await mkdir(path.dirname(output), { recursive: true });
          await convertFile(item.file, output, {
            theme: opts.theme,
            paper: opts.paper,
            showHeaderFooter: opts.headerFooter,
            browser,
          });
          console.log(`${label}완료: ${output}`);
          ok++;
        } catch (err) {
          console.error(`${label}실패: ${item.file} - ${err.message}`);
          failed.push(item.file);
        }
      }
    } finally {
      await browser.close();
    }

    if (files.length > 1) console.log(`\n총 ${files.length}개 중 성공 ${ok}개, 실패 ${failed.length}개`);
    if (failed.length || missing.length) process.exitCode = 1;
  });

program.parseAsync();
