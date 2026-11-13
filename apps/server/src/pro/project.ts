import fs from 'fs/promises';
import fss from 'fs';
import path from 'path';
import { shouldSkipDir, globToRegExp } from './tools/path-safe.js';

/**
 * 项目扫描：给"项目视图"和后端上下文用的一层轻量概览。
 * 只读、限量：尊重 .gitignore（简单规则）、跳过 node_modules 等、限制文件数与深度。
 */

const MAX_FILES = 4000;
const MAX_DEPTH = 8;
const TREE_MAX_ENTRIES = 40;

export interface ProjectScan {
  root: string;
  files: number;
  dirs: number;
  totalBytes: number;
  truncated: boolean;
  byExt: { ext: string; count: number; bytes: number }[];
  top: { name: string; dir: boolean; size?: number }[];
  packageJson: { name?: string; version?: string; scripts?: string[]; deps: number; devDeps: number } | null;
  gitignoreRules: number;
  git: { branch?: string; dirty?: boolean } | null;
}

async function readGitignore(root: string): Promise<RegExp[]> {
  const file = path.join(root, '.gitignore');
  if (!fss.existsSync(file)) return [];
  const text = await fs.readFile(file, 'utf8').catch(() => '');
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'))
    .map((line) => {
      const pattern = line.replace(/^\/+/, '').replace(/\/+$/, '');
      // 目录规则按"任意层级匹配"处理，够用且不用引完整 gitignore 语法
      return globToRegExp(pattern.includes('/') ? `**/${pattern}` : `**/${pattern}`);
    });
}

export async function scanProject(root: string): Promise<ProjectScan> {
  const ignore = await readGitignore(root);
  let files = 0;
  let dirs = 0;
  let totalBytes = 0;
  let truncated = false;
  const extMap = new Map<string, { count: number; bytes: number }>();

  async function step(dir: string, depth: number) {
    if (files >= MAX_FILES || depth > MAX_DEPTH) {
      truncated = true;
      return;
    }
    let entries: fss.Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files >= MAX_FILES) {
        truncated = true;
        return;
      }
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).replace(/\\/g, '/');
      if (ignore.some((re) => re.test(rel))) continue;

      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name)) continue;
        dirs += 1;
        await step(abs, depth + 1);
      } else if (entry.isFile()) {
        files += 1;
        let size = 0;
        try {
          size = (await fs.stat(abs)).size;
        } catch {}
        totalBytes += size;
        const ext = path.extname(entry.name).toLowerCase() || '（无扩展名）';
        const cur = extMap.get(ext) || { count: 0, bytes: 0 };
        cur.count += 1;
        cur.bytes += size;
        extMap.set(ext, cur);
      }
    }
  }

  await step(root, 0);

  const byExt = [...extMap.entries()]
    .map(([ext, v]) => ({ ext, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const top = await fs
    .readdir(root, { withFileTypes: true })
    .then((entries) => entries
      .filter((e) => !shouldSkipDir(e.name))
      .slice(0, TREE_MAX_ENTRIES)
      .map((e) => ({ name: e.name, dir: e.isDirectory() })))
    .catch(() => []);

  let packageJson: ProjectScan['packageJson'] = null;
  const pkgPath = path.join(root, 'package.json');
  if (fss.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
      packageJson = {
        name: pkg.name,
        version: pkg.version,
        scripts: Object.keys(pkg.scripts || {}),
        deps: Object.keys(pkg.dependencies || {}).length,
        devDeps: Object.keys(pkg.devDependencies || {}).length,
      };
    } catch {
      packageJson = null;
    }
  }

  let git: ProjectScan['git'] = null;
  if (fss.existsSync(path.join(root, '.git'))) {
    git = {};
    try {
      const head = await fs.readFile(path.join(root, '.git', 'HEAD'), 'utf8');
      const branch = head.startsWith('ref: ') ? head.slice(5).trim().split('/').pop() : undefined;
      git.branch = branch;
    } catch {}
  }

  return {
    root,
    files,
    dirs,
    totalBytes,
    truncated,
    byExt,
    top,
    packageJson,
    gitignoreRules: ignore.length,
    git,
  };
}
