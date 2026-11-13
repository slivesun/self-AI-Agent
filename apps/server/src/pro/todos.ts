import crypto from 'crypto';
import { proDb } from './db.js';

/**
 * 任务面板（P4）：待办 / 进行中 / 完成三档。
 * 助手通过 `todo_set` 工具改，用户在设计的面板里改，两边共用同一张表。
 */

export type ProTodoStatus = 'pending' | 'doing' | 'done';

export interface ProTodo {
  id: string;
  title: string;
  status: ProTodoStatus;
  note: string;
  sessionId: string | null;
  sort: number;
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
}

function rowToTodo(r: any): ProTodo {
  return {
    id: r.id,
    title: r.title,
    status: (r.status || 'pending') as ProTodoStatus,
    note: r.note || '',
    sessionId: r.session_id ?? null,
    sort: Number(r.sort || 0),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    doneAt: r.done_at ?? null,
  };
}

export function listTodos(options: { status?: ProTodoStatus; limit?: number } = {}): ProTodo[] {
  const limit = Math.max(1, Math.min(200, options.limit || 100));
  const where = options.status ? 'WHERE status = ?' : '';
  const rows = options.status
    ? proDb.prepare(`SELECT * FROM pro_todos ${where} ORDER BY sort ASC, created_at ASC LIMIT ?`).all(options.status, limit)
    : proDb.prepare(`SELECT * FROM pro_todos ${where} ORDER BY CASE status WHEN 'doing' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, sort ASC, created_at ASC LIMIT ?`).all(limit);
  return (rows as any[]).map(rowToTodo);
}

export function addTodo(input: { title: string; note?: string; status?: ProTodoStatus; sessionId?: string }): ProTodo {
  const title = String(input.title || '').trim().slice(0, 200);
  if (!title) throw new Error('任务标题不能为空');
  const id = crypto.randomUUID();
  const status: ProTodoStatus = (['pending', 'doing', 'done'].includes(String(input.status)) ? input.status : 'pending') as ProTodoStatus;
  const maxSort = Number((proDb.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM pro_todos').get() as any)?.m || 0);
  proDb
    .prepare(
      `INSERT INTO pro_todos (id, title, status, note, session_id, sort, done_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      title,
      status,
      String(input.note || '').slice(0, 500),
      input.sessionId || null,
      maxSort + 1,
      status === 'done' ? new Date().toISOString() : null,
    );
  return getTodo(id)!;
}

export function getTodo(id: string): ProTodo | null {
  const row = proDb.prepare('SELECT * FROM pro_todos WHERE id = ?').get(id);
  return row ? rowToTodo(row) : null;
}

/** 按 id 或按标题（标题完全匹配优先）定位任务，方便助手用自然语言指定 */
export function findTodo(keyword: string): ProTodo | null {
  const key = String(keyword || '').trim();
  if (!key) return null;
  const byId = proDb.prepare('SELECT * FROM pro_todos WHERE id = ?').get(key);
  if (byId) return rowToTodo(byId);
  const exact = proDb.prepare('SELECT * FROM pro_todos WHERE title = ?').get(key);
  if (exact) return rowToTodo(exact);
  const like = proDb.prepare('SELECT * FROM pro_todos WHERE title LIKE ? ORDER BY sort ASC LIMIT 1').get(`%${key}%`);
  return like ? rowToTodo(like) : null;
}

export function updateTodo(
  id: string,
  patch: { title?: string; status?: ProTodoStatus; note?: string; sort?: number },
): ProTodo | null {
  const current = getTodo(id);
  if (!current) return null;
  const title = patch.title !== undefined ? String(patch.title).trim().slice(0, 200) || current.title : current.title;
  const status = patch.status && ['pending', 'doing', 'done'].includes(patch.status) ? patch.status : current.status;
  const note = patch.note !== undefined ? String(patch.note).slice(0, 500) : current.note;
  const sort = patch.sort !== undefined ? Number(patch.sort) || 0 : current.sort;
  const doneAt = status === 'done' ? current.doneAt || new Date().toISOString() : null;
  proDb
    .prepare(
      `UPDATE pro_todos SET title = ?, status = ?, note = ?, sort = ?, done_at = ?, updated_at = datetime('now') WHERE id = ?`,
    )
    .run(title, status, note, sort, doneAt, id);
  return getTodo(id);
}

export function deleteTodo(id: string): boolean {
  const result = proDb.prepare('DELETE FROM pro_todos WHERE id = ?').run(id);
  return Number(result.changes || 0) > 0;
}

export function todoStats() {
  const rows = proDb.prepare('SELECT status, COUNT(*) AS n FROM pro_todos GROUP BY status').all() as any[];
  const stats = { pending: 0, doing: 0, done: 0, total: 0 };
  for (const r of rows) {
    const key = r.status as ProTodoStatus;
    if (key in stats) (stats as any)[key] = Number(r.n);
    stats.total += Number(r.n);
  }
  return stats;
}
