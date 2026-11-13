import fs from 'fs/promises';
import fss from 'fs';
import path from 'path';
import type { ToolDef, ToolContext } from './types.js';
import { truncateOutput } from './types.js';
import { resolveToolPath, shouldSkipDir, isProbablyBinary, FILE_LIMITS, globToRegExp } from './path-safe.js';
import { unifiedDiff, diffStats } from './diff.js';

const MAX_LIST_ENTRIES = 300;
const MAX_GLOB_RESULTS = 200;
const MAX_GREP_RESULTS = 60;
const MAX_WALK_FILES = 6000;
const MAX_READ_BYTES = FILE_LIMITS.maxTextBytes;

/** 找这个绝对路径属于哪个工作区，返回展示用的相对路径 */
function locate(abs: string, roots: string[]): { root: string; rel: string } {
  for (const root of roots) {
    const rel = path.relative(root, abs);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      return { root, rel: rel.replace(/\\/g, '/') };
    }
  }
  return { root: path.dirname(abs), rel: path.basename(abs) };
}

/** 落盘后统一记账：写改动清单 + 推给界面 */
function recordAndEmit(ctx: ToolContext, abs: string, action: 'create' | 'edit' | 'overwrite', backupPath: string | null, diff: string) {
  const { root, rel } = locate(abs, ctx.roots);
  const id = ctx.recordChange({ filePath: abs, action, backupPath, diff });
  ctx.emit('change', { changeId: id, path: abs, root, rel, action, diff, backupPath, canRollback: true });
  return id;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function rel(root: string, abs: string): string {
  const r = path.relative(root, abs);
  return (r || '.').replace(/\\/g, '/');
}

/** 递归遍历：限制访问文件数量，自动跳过 node_modules/.git 等目录 */
async function walk(
  root: string,
  onFile: (abs: string) => Promise<boolean | void>,
  options: { maxFiles?: number; pattern?: RegExp } = {},
): Promise<void> {
  const maxFiles = options.maxFiles ?? MAX_WALK_FILES;
  let visited = 0;

  async function step(dir: string, depth: number) {
    if (visited >= maxFiles || depth > 12) return;
    let entries: fss.Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (visited >= maxFiles) return;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name)) continue;
        await step(abs, depth + 1);
      } else if (entry.isFile()) {
        visited += 1;
        if (options.pattern) {
          const relPath = rel(root, abs);
          if (!options.pattern.test(relPath)) continue;
        }
        const stop = await onFile(abs);
        if (stop === true) return;
      }
    }
  }

  await step(root, 0);
}

export const fsList: ToolDef = {
  name: 'fs_list',
  label: '列目录',
  description:
    '列出一个目录下的文件和子目录（只读）。参数 path 可以是相对工作区的路径或绝对路径；depth 控制递归层数（默认 1，最大 3）。自动跳过 node_modules、.git 等目录。',
  level: 'R',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '目录路径，相对工作区或绝对路径；不填则列出工作区根目录' },
      depth: { type: 'number', description: '递归层数，默认 1，最大 3' },
    },
  },
  preview: (args) => `列目录 ${args?.path || '（工作区根目录）'}`,
  async run(args, ctx) {
    const target = resolveToolPath(args?.path || '.', ctx.roots, ctx.extraRoots, { mustExist: true });
    const depth = Math.max(1, Math.min(3, Number(args?.depth) || 1));
    const lines: string[] = [`${target.abs}`];

    let count = 0;
    async function step(dir: string, level: number, prefix: string) {
      if (level > depth || count >= MAX_LIST_ENTRIES) return;
      let entries: fss.Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err: any) {
        lines.push(`${prefix}[无法读取] ${err?.message || err}`);
        return;
      }
      entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
      for (const entry of entries) {
        if (count >= MAX_LIST_ENTRIES) {
          lines.push(`${prefix}…（条目过多，已截断）`);
          return;
        }
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          count += 1;
          lines.push(`${prefix}${entry.name}/`);
          if (!shouldSkipDir(entry.name)) await step(abs, level + 1, `${prefix}  `);
        } else if (entry.isFile()) {
          count += 1;
          let size = 0;
          try { size = (await fs.stat(abs)).size; } catch {}
          lines.push(`${prefix}${entry.name}  (${formatSize(size)})`);
        }
      }
    }

    await step(target.abs, 1, '');
    return truncateOutput(lines.join('\n'));
  },
};

export const fsRead: ToolDef = {
  name: 'fs_read',
  label: '读文件',
  description:
    '读取一个文本文件的内容，带行号（只读）。返回内容用于分析代码或资料；超过约 200KB 会被截断。二进制文件会被拒绝。可以用 offset/limit 只读一部分。',
  level: 'R',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径，相对工作区或绝对路径' },
      offset: { type: 'number', description: '起始行号（从 1 开始），默认 1' },
      limit: { type: 'number', description: '读取行数，默认 400，最大 2000' },
    },
    required: ['path'],
  },
  preview: (args) => `读取 ${args?.path || ''}`,
  async run(args, ctx) {
    const target = resolveToolPath(args?.path, ctx.roots, ctx.extraRoots, { mustExist: true });
    const stat = await fs.stat(target.abs);
    if (stat.isDirectory()) throw new Error('这是一个目录，请用 fs_list 查看');

    const buf = await fs.readFile(target.abs);
    if (isProbablyBinary(buf)) throw new Error('二进制文件不支持读取');
    if (buf.length > MAX_READ_BYTES * 4) {
      throw new Error(`文件过大（${formatSize(buf.length)}），请用 fs_grep 定位后再按行读取`);
    }

    const offset = Math.max(1, Number(args?.offset) || 1);
    const limit = Math.max(1, Math.min(2000, Number(args?.limit) || 400));
    const allLines = buf.toString('utf8').split(/\r?\n/);
    const slice = allLines.slice(offset - 1, offset - 1 + limit);

    const numbered = slice.map((line, i) => `${String(offset + i).padStart(5, ' ')}| ${line}`).join('\n');
    const header = `${target.abs}（共 ${allLines.length} 行，本次 ${offset}-${Math.min(allLines.length, offset + limit - 1)} 行）`;
    return truncateOutput(`${header}\n${numbered}`);
  },
};

export const fsGlob: ToolDef = {
  name: 'fs_glob',
  label: '按名检索文件',
  description:
    '按文件名模式递归查找文件（只读），支持 * ? 和 ** 以及 {a,b}，例如 **/*.tsx、src/**/*.ts。返回相对路径和大小。',
  level: 'R',
  schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'glob 模式，例如 **/*.ts' },
      root: { type: 'string', description: '从哪个目录开始找，默认第一个工作区根目录' },
    },
    required: ['pattern'],
  },
  preview: (args) => `按模式查找 ${args?.pattern || ''}`,
  async run(args, ctx) {
    const pattern = String(args?.pattern || '').trim();
    if (!pattern) throw new Error('缺少 pattern');
    const base = resolveToolPath(args?.root || '.', ctx.roots, ctx.extraRoots, { mustExist: true });
    if (!fss.statSync(base.abs).isDirectory()) throw new Error('root 必须是目录');

    const re = globToRegExp(pattern);
    const results: string[] = [];

    await walk(
      base.abs,
      async (abs) => {
        const relPath = rel(base.abs, abs);
        if (!re.test(relPath)) return;
        let size = 0;
        try { size = (await fs.stat(abs)).size; } catch {}
        results.push(`${relPath}  (${formatSize(size)})`);
        return results.length >= MAX_GLOB_RESULTS;
      },
      { pattern: undefined },
    );

    if (!results.length) return `没有匹配 ${pattern} 的文件（根目录：${base.abs}）`;
    return truncateOutput(results.join('\n'));
  },
};

export const fsGrep: ToolDef = {
  name: 'fs_grep',
  label: '按内容检索',
  description:
    '在目录里按内容检索（只读），返回 文件:行号: 内容。pattern 按正则处理；include 可限定文件类型（如 *.ts）。自动跳过二进制和大文件。',
  level: 'R',
  schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: '要搜索的文本或正则' },
      path: { type: 'string', description: '搜索目录，默认工作区根目录' },
      include: { type: 'string', description: '只搜匹配该 glob 的文件，例如 *.ts' },
      caseSensitive: { type: 'boolean', description: '是否区分大小写，默认 false' },
    },
    required: ['pattern'],
  },
  preview: (args) => `检索 "${args?.pattern || ''}"`,
  async run(args, ctx) {
    const pattern = String(args?.pattern || '');
    if (!pattern) throw new Error('缺少 pattern');
    let re: RegExp;
    try {
      re = new RegExp(pattern, args?.caseSensitive ? '' : 'i');
    } catch {
      throw new Error('pattern 不是合法正则');
    }

    const base = resolveToolPath(args?.path || '.', ctx.roots, ctx.extraRoots, { mustExist: true });
    const include = args?.include ? globToRegExp(String(args.include)) : null;
    const results: string[] = [];

    await walk(
      base.abs,
      async (abs) => {
        const relPath = rel(base.abs, abs);
        if (include && !include.test(relPath)) return;
        let buf: Buffer;
        try {
          const stat = await fs.stat(abs);
          if (stat.size > FILE_LIMITS.maxScanBytes) return;
          buf = await fs.readFile(abs);
        } catch {
          return;
        }
        if (isProbablyBinary(buf)) return;
        const lines = buf.toString('utf8').split(/\r?\n/);
        for (let i = 0; i < lines.length; i += 1) {
          if (!re.test(lines[i])) continue;
          results.push(`${relPath}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
          if (results.length >= MAX_GREP_RESULTS) return true;
        }
        return;
      },
    );

    if (!results.length) return `没有匹配 "${pattern}" 的内容（目录：${base.abs}）`;
    return truncateOutput(results.join('\n'));
  },
};

export const fsWrite: ToolDef = {
  name: 'fs_write',
  label: '写文件',
  description:
    '新建或整体覆盖一个文件（写入前系统会自动备份原文件）。适合创建新文件；修改已有文件的局部内容请优先用 fs_edit，避免覆盖掉不相关内容。',
  level: 'W',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径，相对工作区或绝对路径' },
      content: { type: 'string', description: '完整文件内容' },
    },
    required: ['path', 'content'],
  },
  preview: (args) => {
    const content = String(args?.content ?? '');
    return `写入 ${args?.path || ''}（${content.length} 字符，${content.split(/\r?\n/).length} 行）`;
  },
  async run(args, ctx) {
    const content = String(args?.content ?? '');
    if (content.length > 400_000) throw new Error('内容过大（超过 40 万字符），请拆分写入');
    const target = resolveToolPath(args?.path, ctx.roots, ctx.extraRoots, { allowCreate: true, mustExist: false });

    const existed = fss.existsSync(target.abs);
    const before = existed ? await fs.readFile(target.abs, 'utf8').catch(() => '') : '';
    if (existed && before === content) return `文件内容无变化，未写入：${target.abs}`;

    const backupPath = existed ? await ctx.backup(target.abs) : null;
    await fs.mkdir(path.dirname(target.abs), { recursive: true });
    await fs.writeFile(target.abs, content, 'utf8');

    const { rel } = locate(target.abs, ctx.roots);
    const diff = unifiedDiff(before, content, rel);
    const stats = diffStats(diff);
    recordAndEmit(ctx, target.abs, existed ? 'overwrite' : 'create', backupPath, diff);

    const bytes = Buffer.byteLength(content, 'utf8');
    return truncateOutput(
      `${existed ? '已覆盖' : '已新建'} ${target.abs}（${formatSize(bytes)}，+${stats.added} / -${stats.removed} 行）` +
        `${backupPath ? `\n原文件备份：${backupPath}` : ''}\n\n${diff}`,
    );
  },
};

export const fsEdit: ToolDef = {
  name: 'fs_edit',
  label: '改文件',
  description:
    '对已有文本文件做精确替换（写入前自动备份）。old_string 必须能在文件里唯一匹配（包括缩进和换行），匹配不到或匹配多处都会报错，这时请补充更多上下文再试，或用 replace_all=true 替换全部。',
  level: 'W',
  schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径' },
      old_string: { type: 'string', description: '要被替换的原文本（需唯一匹配）' },
      new_string: { type: 'string', description: '替换后的文本' },
      replace_all: { type: 'boolean', description: '是否替换所有匹配处，默认 false' },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  preview: (args) => `修改 ${args?.path || ''}（${String(args?.old_string || '').split(/\r?\n/).length} 行 → ${String(args?.new_string || '').split(/\r?\n/).length} 行）`,
  async run(args, ctx) {
    const oldStr = String(args?.old_string ?? '');
    const newStr = String(args?.new_string ?? '');
    if (!oldStr) throw new Error('old_string 不能为空');

    const target = resolveToolPath(args?.path, ctx.roots, ctx.extraRoots, { mustExist: true });
    const stat = await fs.stat(target.abs);
    if (stat.isDirectory()) throw new Error('这是目录，不能编辑');

    const original = await fs.readFile(target.abs, 'utf8');
    const occurrences = oldStr === newStr ? 0 : original.split(oldStr).length - 1;
    if (occurrences === 0) {
      throw new Error('在文件中没有找到 old_string（注意缩进、换行必须完全一致）');
    }
    if (occurrences > 1 && !args?.replace_all) {
      throw new Error(`old_string 在文件中匹配到 ${occurrences} 处，请补充更多上下文使其唯一，或设置 replace_all=true`);
    }

    const updated = args?.replace_all ? original.split(oldStr).join(newStr) : original.replace(oldStr, newStr);
    const backupPath = await ctx.backup(target.abs);
    await fs.writeFile(target.abs, updated, 'utf8');

    const { rel } = locate(target.abs, ctx.roots);
    const diff = unifiedDiff(original, updated, rel);
    const stats = diffStats(diff);
    recordAndEmit(ctx, target.abs, 'edit', backupPath, diff);

    return truncateOutput(
      `已修改 ${target.abs}（替换 ${args?.replace_all ? occurrences : 1} 处，+${stats.added} / -${stats.removed} 行）` +
        `${backupPath ? `\n原文件备份：${backupPath}` : ''}\n\n${diff}`,
    );
  },
};
