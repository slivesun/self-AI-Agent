/**
 * P3 docx 自检：用自研 markdownToDocx 生成一份 docx，再用 mammoth 读回来。
 * 目的：证明"我们手搓的 stored zip + OOXML"确实能被真实的 docx 解析器吃进去，
 * 而不是只有自己觉得对。
 *
 * 用法：
 *   npx tsx scripts/pro-docx-check.mjs unit            # 自造样本往返
 *   npx tsx scripts/pro-docx-check.mjs file <路径>      # 检查一个真实产物能否被读回
 */

import fs from 'node:fs/promises';
import mammoth from 'mammoth';
import { markdownToDocx } from '../src/pro/docx.ts';

const SAMPLE = `# 冒烟文档
## 二级标题

这是一段正文，包含 **加粗内容** 和 \`inline code\`。

- 列表项一
- 列表项二

> 引用：这句话应该被读出来。

\`\`\`
const a = 1;
\`\`\`
`;

async function runUnit() {
  const buffer = markdownToDocx(SAMPLE);
  if (buffer.length < 500) throw new Error(`生成的 docx 太小（${buffer.length} 字节）`);
  const text = await mammoth.extractRawText({ buffer });
  const got = String(text.value || '').replace(/\s+/g, ' ');
  for (const expect of ['冒烟文档', '二级标题', '这是一段正文', '列表项一', '引用：这句话应该被读出来', 'const a = 1;']) {
    if (!got.includes(expect.replace(/\s+/g, ' '))) throw new Error(`读回内容缺少「${expect}」：${got.slice(0, 200)}`);
  }
  console.log(`UNIT_OK bytes=${buffer.length} chars=${got.length}`);
}

async function runFile(file) {
  const buffer = await fs.readFile(file);
  const text = String((await mammoth.extractRawText({ buffer })).value || '').replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('产物 docx 读出来的内容是空的');
  if (!text.includes('冒烟文档')) throw new Error(`产物 docx 读回内容不含预期标题：${text.slice(0, 160)}`);
  console.log(`FILE_OK chars=${text.length} head=${text.slice(0, 40)}`);
}

const [mode, file] = process.argv.slice(2);
try {
  if (mode === 'unit') await runUnit();
  else if (mode === 'file' && file) await runFile(file);
  else throw new Error('用法：unit | file <path>');
} catch (err) {
  console.error(`CHECK_FAIL ${err?.message || err}`);
  process.exit(1);
}
