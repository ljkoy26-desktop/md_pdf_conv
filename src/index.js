#!/usr/bin/env node
import { access } from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { convertFile } from './converter.js';

const program = new Command();

program
  .name('md2pdf')
  .description('Markdown 파일을 PDF로 변환합니다')
  .argument('<input>', '입력 .md 파일')
  .option('-o, --output <file>', '출력 .pdf 파일 (기본: 입력 파일명.pdf)')
  .option('-t, --theme <name>', '테마 (src/themes/<name>.css)', 'github')
  .option('-p, --paper <size>', '용지 크기 (A4, Letter 등)', 'A4')
  .action(async (input, opts) => {
    try {
      await access(input);
    } catch {
      console.error(`입력 파일을 찾을 수 없습니다: ${input}`);
      process.exit(1);
    }
    const output = opts.output ?? path.join(path.dirname(input), path.basename(input, path.extname(input)) + '.pdf');
    try {
      const out = await convertFile(input, output, { theme: opts.theme, paper: opts.paper });
      console.log(`완료: ${out}`);
    } catch (err) {
      console.error(`변환 실패: ${err.message}`);
      process.exit(1);
    }
  });

program.parseAsync();
