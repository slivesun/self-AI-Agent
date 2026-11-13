import fs from 'fs';
import path from 'path';

/**
 * 路径白名单：任何文件工具都必须先过这里。
 * - 只允许落在已授权工作区（或显式给的额外目录）内；
 * - 用真实路径比较，防止软链接逃逸；
 * - Windows 盘符/大小写不敏感，统一小写比较。
 */

const MAX_TEXT_BYTES = 200 * 1024; // 单次读取上限
const MAX_SCAN_BYTES = 512 * 1024; // 检索时单文件上限
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'target', 'coverage',
  '.idea', '.vscode', '__pycache__', '.cache', '.turbo', 'vendor', 'out',
]);

export function shouldSkipDir(name: string): boolean {
  return SKIP_DIRS.has(name.toLowerCase()) || name.startsWith('.git');
}

export function isProbablyBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, 4096);
  for (let i = 0; i < len; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** target 是否在 root 之内（相等也算在内） */
export function isInside(root: string, target: string): boolean {
  const r = process.platform === 'win32' ? root.toLowerCase() : root;
  const t = process.platform === 'win32' ? target.toLowerCase() : target;
  if (t === r) return true;
  const sep = process.platform === 'win32' ? '\\' : '/';
  return t.startsWith(r.endsWith(sep) ? r : r + sep);
}

export interface ResolveOptions {
  /** 是否要求文件已存在（读/编辑为 true，新建为 false） */
  mustExist?: boolean;
  /** 是否允许创建新文件（写工具为 true） */
  allowCreate?: boolean;
}

export interface ResolvedPath {
  abs: string;
  root: string;
}

/**
 * 把模型给的路径解析成受信任的绝对路径。
 * 规则：相对路径以第一个工作区为基准；绝对路径必须在某个白名单根目录内。
 */
export function resolveToolPath(input: any, roots: string[], extraRoots: string[] = [], options: ResolveOptions = {}): ResolvedPath {
  const allRoots = [...roots, ...extraRoots].filter(Boolean);
  if (!allRoots.length) {
    throw new Error('尚未授权任何工作区，请先在「设置 → 工作区」里添加本地目录');
  }

  const raw = String(input ?? '').trim().replace(/^["']|["']$/g, '');
  if (!raw) throw new Error('缺少路径参数');

  const isAbs = path.isAbsolute(raw);
  let candidate: string;
  if (isAbs) {
    candidate = path.normalize(raw);
  } else {
    const base = roots[0];
    if (!base) throw new Error('未授权工作区，无法解析相对路径');
    candidate = path.resolve(base, raw);
  }

  // 先判断候选路径是否落在白名单根的“字面”范围内（防止 ../ 穿越）
  const matchedRoot = allRoots.find((root) => isInside(root, candidate));
  if (!matchedRoot) {
    throw new Error(`路径不在已授权的工作区内：${candidate}`);
  }

  // 存在的文件/目录：取真实路径再校验一次，防止软链接指向外部
  if (fs.existsSync(candidate)) {
    const stat = fs.statSync(candidate);
    const real = fs.realpathSync(candidate);
    const realRoot = fs.realpathSync(matchedRoot);
    if (!isInside(realRoot, real)) throw new Error(`路径解析后超出授权范围：${candidate}`);
    if (!stat.isDirectory() && stat.size > MAX_SCAN_BYTES && options.mustExist) {
      // 超大文件由调用方按需处理，这里不阻断读取（read 工具有自己的上限）
    }
    return { abs: real, root: realRoot };
  }

  if (options.mustExist) throw new Error(`文件或目录不存在：${candidate}`);
  if (!options.allowCreate) throw new Error(`文件或目录不存在：${candidate}`);

  // 新建：用根目录的真实路径 + 相对路径拼出目标，保证写入点仍在白名单内
  const realRoot = fs.realpathSync(matchedRoot);
  const rel = path.relative(matchedRoot, candidate);
  const abs = path.join(realRoot, rel);
  if (!isInside(realRoot, abs)) throw new Error(`写入路径超出授权范围：${abs}`);
  return { abs, root: realRoot };
}

export const FILE_LIMITS = { maxTextBytes: MAX_TEXT_BYTES, maxScanBytes: MAX_SCAN_BYTES };

export { samePath };

/** 简单 glob → 正则（支持 ** / * / ? / {a,b}） */
export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/\\/g, '/')
    .replace(/[.+^$()|[\]]/g, (m) => `\\${m}`)
    .replace(/\{([^}]+)\}/g, (_m, group: string) => `(${group.split(',').map((s) => s.trim()).join('|')})`)
    .replace(/\*\*\//g, '<<<ANYDIR>>>')
    .replace(/\*\*/g, '<<<ANYS>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/<<<ANYDIR>>>/g, '(?:[^/]+/)*')
    .replace(/<<<ANYS>>>/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}
