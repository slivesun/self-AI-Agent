import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { PRO_ARTIFACTS_DIR } from './paths.js';
import { insertProArtifact, type ProArtifactKind } from './db.js';

/**
 * 产物落盘 + 入库。
 * 约定：物理文件统一放 pro/artifacts/<kind>/，db 只存路径与元信息，便于按会话/类型列画廊。
 */

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.html': 'text/html',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
};

export function mimeFor(filename: string): string {
  return MIME_BY_EXT[path.extname(filename).toLowerCase()] || 'application/octet-stream';
}

function kindDir(kind: ProArtifactKind) {
  return path.join(PRO_ARTIFACTS_DIR, kind);
}

function safeTitle(title: string, fallbackExt: string) {
  const cleaned = String(title || '').replace(/[\\/:*?"<>|\r\n]+/g, '_').trim().slice(0, 60);
  const base = cleaned || 'artifact';
  return base.toLowerCase().endsWith(fallbackExt) ? base : `${base}${fallbackExt}`;
}

export interface SaveArtifactInput {
  sessionId?: string;
  runId?: string;
  kind: ProArtifactKind;
  title: string;
  ext: string;
  /** 二选一：直接给内容，或给一个现成文件路径（会复制进产物库） */
  data?: Buffer | string;
  sourcePath?: string;
  mime?: string;
  meta?: any;
}

export async function saveArtifact(input: SaveArtifactInput) {
  const id = crypto.randomUUID();
  const dir = kindDir(input.kind);
  await fs.mkdir(dir, { recursive: true });

  const filename = safeTitle(input.title, input.ext);
  const abs = path.join(dir, `${id.slice(0, 8)}-${filename}`);

  if (input.sourcePath) {
    const stat = await fs.stat(input.sourcePath);
    await fs.copyFile(input.sourcePath, abs);
    const record = {
      id,
      sessionId: input.sessionId,
      runId: input.runId,
      kind: input.kind,
      title: filename,
      filePath: abs,
      mime: input.mime || mimeFor(filename),
      size: stat.size,
      meta: input.meta || {},
    };
    insertProArtifact(record);
    return { ...record, createdAt: new Date().toISOString() };
  }

  const data = typeof input.data === 'string' ? Buffer.from(input.data, 'utf8') : (input.data as Buffer);
  await fs.writeFile(abs, data);
  const record = {
    id,
    sessionId: input.sessionId,
    runId: input.runId,
    kind: input.kind,
    title: filename,
    filePath: abs,
    mime: input.mime || mimeFor(filename),
    size: data.length,
    meta: input.meta || {},
  };
  insertProArtifact(record);
  return { ...record, createdAt: new Date().toISOString() };
}

export async function readArtifactBuffer(id: string, filePath: string) {
  const abs = path.resolve(filePath);
  const rel = path.relative(path.resolve(PRO_ARTIFACTS_DIR), abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('产物路径不合法');
  return fs.readFile(abs);
}
