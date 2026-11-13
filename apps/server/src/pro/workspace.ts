import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { proDb } from './db.js';

/** 专业版工作区（已授权的本地目录）。所有文件工具只能在白名单目录内活动。 */
export interface ProWorkspace {
  id: string;
  path: string;
  label: string;
  createdAt: string;
}

export function listWorkspaces(): ProWorkspace[] {
  const rows = proDb.prepare('SELECT id, path, label, created_at FROM pro_workspaces ORDER BY created_at ASC').all() as any[];
  return rows.map((r) => ({ id: r.id, path: r.path, label: r.label || '', createdAt: r.created_at }));
}

function normalizeDir(raw: string): string {
  const value = String(raw || '').trim().replace(/^["']|["']$/g, '');
  if (!value) throw new Error('请填写目录路径');
  const abs = path.resolve(value);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new Error(`目录不存在：${abs}`);
  }
  if (!stat.isDirectory()) throw new Error(`不是目录：${abs}`);
  // 存真实路径，避免软链接把白名单绕开
  return fs.realpathSync(abs);
}

export function addWorkspace(raw: string, label?: string): ProWorkspace {
  const real = normalizeDir(raw);
  const exists = proDb.prepare('SELECT id FROM pro_workspaces WHERE path = ?').get(real) as any;
  if (exists) throw new Error('该目录已在工作区列表中');
  const id = crypto.randomUUID();
  const name = (label || path.basename(real) || '工作区').slice(0, 40);
  proDb.prepare('INSERT INTO pro_workspaces (id, path, label) VALUES (?, ?, ?)').run(id, real, name);
  return { id, path: real, label: name, createdAt: new Date().toISOString() };
}

export function removeWorkspace(id: string) {
  proDb.prepare('DELETE FROM pro_workspaces WHERE id = ?').run(id);
}

/** 授权根目录（真实路径），供工具层做白名单校验 */
export function getWorkspaceRoots(): string[] {
  return listWorkspaces().map((w) => w.path);
}
