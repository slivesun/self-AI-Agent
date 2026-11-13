import fs from 'fs/promises';
import path from 'path';
import type { ToolDef } from './types.js';
import { truncateOutput } from './types.js';
import { resolveToolPath, isProbablyBinary } from './path-safe.js';
import { markdownToDocx } from '../docx.js';
import { saveArtifact } from '../artifacts.js';
import { parseDocx, parsePdf } from '../../parse.js';

const MAX_READ_CHARS = 8000;

/**
 * Markdown → DOCX，产物入库。
 * 不用 docx 库：自研 stored-zip 打包 OOXML，避免为一次导出引依赖。
 */
export const docExport: ToolDef = {
  name: 'doc_export',
  label: '导出 Word',
  description:
    '把一段 Markdown 文本导出成 .docx（Word / WPS 可直接打开），文件进入产物库并出现在会话里。支持标题、列表、引用、代码块、**加粗**、`行内代码`。也支持把工作区里的 .md 文件导出。',
  level: 'W',
  schema: {
    type: 'object',
    properties: {
      markdown: { type: 'string', description: '要导出的 Markdown 内容；与 source 二选一' },
      source: { type: 'string', description: '工作区里已有的 .md 文件路径；与 markdown 二选一' },
      title: { type: 'string', description: '文件名（不含扩展名），默认「文档」' },
    },
  },
  preview: (args) => {
    const chars = String(args?.markdown || '').length;
    return `导出 Word：${args?.title || '文档'}（${args?.source ? `来源 ${args.source}` : `${chars} 字符`}）`;
  },
  async run(args, ctx) {
    let markdown = String(args?.markdown || '');
    if (!markdown && args?.source) {
      const source = resolveToolPath(String(args.source), ctx.roots, ctx.extraRoots, { mustExist: true });
      markdown = await fs.readFile(source.abs, 'utf8');
    }
    if (!markdown.trim()) throw new Error('markdown 为空（也可以传 source 指向一个 .md 文件）');
    if (markdown.length > 400_000) throw new Error('内容过大（超过 40 万字符），请拆分导出');

    const buffer = markdownToDocx(markdown);
    const title = String(args?.title || '文档').trim() || '文档';
    const artifact = await saveArtifact({
      sessionId: ctx.sessionId,
      runId: ctx.runId,
      kind: 'doc',
      title,
      ext: '.docx',
      data: buffer,
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      meta: { chars: markdown.length },
    });

    ctx.emit('artifact', {
      id: artifact.id,
      kind: artifact.kind,
      title: artifact.title,
      filePath: artifact.filePath,
      mime: artifact.mime,
      size: artifact.size,
      url: `/api/pro/artifacts/${artifact.id}/file`,
    });

    return `已导出 Word：${artifact.title}（${Math.round(artifact.size / 1024)}KB）\n产物地址：/api/pro/artifacts/${artifact.id}/file\n本地路径：${artifact.filePath}`;
  },
};

/** 读 docx / pdf / 文本，进对话分析 */
export const docRead: ToolDef = {
  name: 'doc_read',
  label: '读文档',
  description:
    '读取 .docx / .pdf / .md / .txt 的内容（只读），返回纯文本用于分析或改写。PDF 与 Word 会先抽取文字（不保留排版）。超大文档只返回前 8000 字符。',
  level: 'R',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文档路径，相对工作区或绝对路径' },
      limit: { type: 'number', description: '最多返回字符数，默认 8000' },
    },
    required: ['path'],
  },
  preview: (args) => `读文档 ${args?.path || ''}`,
  async run(args, ctx) {
    const target = resolveToolPath(args?.path, ctx.roots, ctx.extraRoots, { mustExist: true });
    const ext = path.extname(target.abs).toLowerCase();
    const stat = await fs.stat(target.abs);
    if (stat.isDirectory()) throw new Error('这是目录，请用 fs_list');
    if (stat.size > 50 * 1024 * 1024) throw new Error('文件过大（超过 50MB）');

    const limit = Math.max(500, Math.min(20_000, Number(args?.limit) || MAX_READ_CHARS));

    let text = '';
    if (ext === '.docx') {
      text = await parseDocx(await fs.readFile(target.abs));
    } else if (ext === '.pdf') {
      text = await parsePdf(await fs.readFile(target.abs));
    } else if (['.md', '.txt', '.markdown', '.json', '.csv', '.log'].includes(ext)) {
      const buf = await fs.readFile(target.abs);
      if (isProbablyBinary(buf)) throw new Error('看起来是二进制文件，不支持按文本读取');
      text = buf.toString('utf8');
    } else {
      throw new Error(`不支持的文档格式：${ext || '（无扩展名）'}，支持 docx / pdf / md / txt`);
    }

    text = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) throw new Error('文档里没有可读文字（可能是扫描件图片 PDF）');

    const clipped = text.length > limit ? `${text.slice(0, limit)}\n…（共 ${text.length} 字符，已截断）` : text;
    return truncateOutput(`文档：${target.abs}（${ext}，${Math.round(stat.size / 1024)}KB，${text.length} 字符）\n\n${clipped}`);
  },
};
