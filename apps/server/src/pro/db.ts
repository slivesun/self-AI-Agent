import { DatabaseSync } from 'node:sqlite';
import { PRO_DB_PATH } from './paths.js';

/**
 * 专业版独立数据库。
 * 不与普通版共用 resume-agent.db：表、迁移台账、连接都独立，避免两版数据互相污染。
 */
export const proDb = new DatabaseSync(PRO_DB_PATH);
proDb.exec('PRAGMA journal_mode = WAL');

export function initProDb() {
  proDb.exec(`
    CREATE TABLE IF NOT EXISTS pro_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '新会话',
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pro_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      meta TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pro_workspaces (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pro_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- 用量分账：两版共用同一把模型 Key，但专业版单独记账
    CREATE TABLE IF NOT EXISTS pro_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      run_id TEXT,
      model TEXT,
      input_chars INTEGER NOT NULL DEFAULT 0,
      output_chars INTEGER NOT NULL DEFAULT 0,
      est_tokens INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 专业版审计：工具调用与权限决策（不记完整文件内容）
    CREATE TABLE IF NOT EXISTS pro_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      run_id TEXT,
      tool TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'R',
      args TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ok',
      duration_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 改动清单：每次落盘记一条，带 diff 与备份路径，供界面展示与一键回滚
    CREATE TABLE IF NOT EXISTS pro_changes (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      run_id TEXT,
      workspace TEXT,
      file_path TEXT NOT NULL,
      action TEXT NOT NULL DEFAULT 'edit',
      backup_path TEXT,
      diff TEXT NOT NULL DEFAULT '',
      rolled_back_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 产物库：助手生成的图片 / 文档 / HTML 设计稿 / PDF，统一放 pro/artifacts
    CREATE TABLE IF NOT EXISTS pro_artifacts (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      run_id TEXT,
      kind TEXT NOT NULL DEFAULT 'other',
      title TEXT NOT NULL DEFAULT '',
      file_path TEXT NOT NULL,
      mime TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      meta TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 任务面板：待办 / 进行中 / 完成，助手与用户都能改
    CREATE TABLE IF NOT EXISTS pro_todos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      note TEXT NOT NULL DEFAULT '',
      session_id TEXT,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      done_at TEXT
    );
  `);

  runMigrations();
}

function runMigrations() {
  proDb.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    (proDb.prepare('SELECT version FROM schema_migrations').all() as any[]).map((r) => Number(r.version)),
  );

  const migrations: { version: number; name: string; up: () => void }[] = [
    {
      version: 1,
      name: 'pro-core-indexes',
      up: () => {
        proDb.exec(`
          CREATE INDEX IF NOT EXISTS idx_pro_messages_session ON pro_messages(session_id, created_at);
          CREATE INDEX IF NOT EXISTS idx_pro_sessions_updated ON pro_sessions(updated_at);
          CREATE INDEX IF NOT EXISTS idx_pro_audit_created ON pro_audit_logs(created_at);
          CREATE INDEX IF NOT EXISTS idx_pro_usage_created ON pro_usage(created_at);
        `);
      },
    },
    {
      version: 2,
      name: 'pro-changes-index',
      up: () => {
        proDb.exec(`
          CREATE INDEX IF NOT EXISTS idx_pro_changes_session ON pro_changes(session_id, created_at);
          CREATE INDEX IF NOT EXISTS idx_pro_changes_run ON pro_changes(run_id);
        `);
      },
    },
    {
      version: 3,
      name: 'pro-artifacts-index',
      up: () => {
        proDb.exec(`
          CREATE INDEX IF NOT EXISTS idx_pro_artifacts_session ON pro_artifacts(session_id, created_at);
          CREATE INDEX IF NOT EXISTS idx_pro_artifacts_kind ON pro_artifacts(kind, created_at);
        `);
      },
    },
    {
      version: 4,
      name: 'pro-todos-index',
      up: () => {
        proDb.exec(`
          CREATE INDEX IF NOT EXISTS idx_pro_todos_status ON pro_todos(status, sort, created_at);
          CREATE INDEX IF NOT EXISTS idx_pro_todos_session ON pro_todos(session_id);
        `);
      },
    },
  ];

  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    m.up();
    proDb.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(m.version);
    console.log(`[pro.db] 迁移已应用：${m.version}-${m.name}`);
  }
}

// ===== 会话 =====

export type ProSessionRow = { id: string; title: string; pinned: number; created_at: string; updated_at: string };

export function listProSessions() {
  const rows = proDb
    .prepare(
      `SELECT s.id, s.title, s.pinned, s.created_at, s.updated_at,
              (SELECT content FROM pro_messages WHERE session_id = s.id AND role = 'user' ORDER BY created_at ASC, rowid ASC LIMIT 1) AS first_user,
              (SELECT content FROM pro_messages WHERE session_id = s.id ORDER BY created_at DESC, rowid DESC LIMIT 1) AS last_msg,
              (SELECT COUNT(*) FROM pro_messages WHERE session_id = s.id) AS msg_count
       FROM pro_sessions s
       ORDER BY s.pinned DESC, s.updated_at DESC`,
    )
    .all() as any[];

  return rows.map((r) => ({
    id: r.id,
    title: r.title || '新会话',
    pinned: !!r.pinned,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    preview: String(r.last_msg || '').replace(/\s+/g, ' ').slice(0, 60),
    messageCount: Number(r.msg_count || 0),
  }));
}

export function createProSession(id: string, title = '新会话') {
  proDb
    .prepare('INSERT INTO pro_sessions (id, title) VALUES (?, ?)')
    .run(id, title);
  return { id, title };
}

export function updateProSession(id: string, patch: { title?: string; pinned?: boolean }) {
  const row = proDb.prepare('SELECT id FROM pro_sessions WHERE id = ?').get(id) as any;
  if (!row) return false;
  if (typeof patch.title === 'string' && patch.title.trim()) {
    proDb.prepare('UPDATE pro_sessions SET title = ?, updated_at = datetime(\'now\') WHERE id = ?').run(patch.title.trim().slice(0, 60), id);
  }
  if (typeof patch.pinned === 'boolean') {
    proDb.prepare('UPDATE pro_sessions SET pinned = ? WHERE id = ?').run(patch.pinned ? 1 : 0, id);
  }
  return true;
}

export function touchProSession(id: string) {
  proDb.prepare("UPDATE pro_sessions SET updated_at = datetime('now') WHERE id = ?").run(id);
}

export function deleteProSession(id: string) {
  proDb.prepare('DELETE FROM pro_messages WHERE session_id = ?').run(id);
  proDb.prepare('DELETE FROM pro_sessions WHERE id = ?').run(id);
}

export function sessionExists(id: string) {
  return !!proDb.prepare('SELECT id FROM pro_sessions WHERE id = ?').get(id);
}

// ===== 消息 =====

export type ProMessageMeta = {
  tools?: any[];
  changes?: any[];
  artifacts?: any[];
  /** 联网痕迹：本轮是否允许联网、搜索次数、引用链接 */
  search?: { enabled: boolean; count: number; fetches: number; links: { title: string; url: string }[] };
  /** 用户消息上的单轮开关快照 */
  searchEnabled?: boolean;
  usage?: { estTokens: number; model: string };
  stopped?: boolean;
  error?: string;
  attachments?: { name: string; path: string; size: number; mime: string }[];
};

export interface ProMessageRecord {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  meta: ProMessageMeta;
  createdAt: string;
}

export function insertProMessage(input: {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  meta?: ProMessageMeta;
}) {
  proDb
    .prepare('INSERT INTO pro_messages (id, session_id, role, content, meta) VALUES (?, ?, ?, ?, ?)')
    .run(input.id, input.sessionId, input.role, input.content, JSON.stringify(input.meta || {}));
  touchProSession(input.sessionId);
}

export function listProMessages(sessionId: string): ProMessageRecord[] {
  const rows = proDb
    .prepare('SELECT id, session_id, role, content, meta, created_at FROM pro_messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC')
    .all(sessionId) as any[];

  return rows.map((r) => {
    let meta: ProMessageMeta = {};
    try {
      const parsed = JSON.parse(r.meta || '{}');
      meta = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      meta = {};
    }
    return {
      id: r.id,
      sessionId: r.session_id,
      role: r.role,
      content: r.content,
      meta,
      createdAt: r.created_at,
    };
  });
}

// ===== 改动清单 / 回滚 =====

export interface ProChangeRow {
  id: string;
  sessionId: string | null;
  runId: string | null;
  workspace: string | null;
  filePath: string;
  action: string;
  backupPath: string | null;
  diff: string;
  rolledBackAt: string | null;
  createdAt: string;
}

export function insertProChange(input: {
  id: string;
  sessionId?: string;
  runId?: string;
  workspace?: string;
  filePath: string;
  action: 'create' | 'edit' | 'overwrite' | 'delete';
  backupPath?: string | null;
  diff?: string;
}) {
  try {
    proDb
      .prepare(
        `INSERT INTO pro_changes (id, session_id, run_id, workspace, file_path, action, backup_path, diff)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.sessionId || null,
        input.runId || null,
        input.workspace || null,
        input.filePath,
        input.action,
        input.backupPath || null,
        (input.diff || '').slice(0, 20_000),
      );
  } catch (err: any) {
    console.warn('[pro] 改动清单写入失败:', err?.message || err);
  }
}

function mapChange(r: any): ProChangeRow {
  return {
    id: r.id,
    sessionId: r.session_id,
    runId: r.run_id,
    workspace: r.workspace,
    filePath: r.file_path,
    action: r.action,
    backupPath: r.backup_path,
    diff: r.diff || '',
    rolledBackAt: r.rolled_back_at,
    createdAt: r.created_at,
  };
}

export function listProChanges(options: { sessionId?: string; limit?: number } = {}) {
  const limit = Math.min(200, Math.max(1, options.limit || 50));
  const rows = options.sessionId
    ? (proDb
        .prepare('SELECT * FROM pro_changes WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
        .all(options.sessionId, limit) as any[])
    : (proDb.prepare('SELECT * FROM pro_changes ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit) as any[]);
  return rows.map(mapChange);
}

/** 某次运行产生的改动（落库进助手消息的 meta，刷新后仍能看到 diff 与回滚按钮） */
export function listProChangesByRun(runId: string) {
  const rows = proDb
    .prepare('SELECT * FROM pro_changes WHERE run_id = ? ORDER BY created_at ASC, rowid ASC')
    .all(runId) as any[];
  return rows.map(mapChange);
}

export function getProChange(id: string): ProChangeRow | null {  const row = proDb.prepare('SELECT * FROM pro_changes WHERE id = ?').get(id) as any;
  return row ? mapChange(row) : null;
}

export function markProChangeRolledBack(id: string) {
  proDb.prepare("UPDATE pro_changes SET rolled_back_at = datetime('now') WHERE id = ?").run(id);
}

// ===== 产物库 =====

export type ProArtifactKind = 'image' | 'doc' | 'html' | 'pdf' | 'text' | 'other';

export interface ProArtifactRow {
  id: string;
  sessionId: string | null;
  runId: string | null;
  kind: ProArtifactKind;
  title: string;
  filePath: string;
  mime: string;
  size: number;
  meta: any;
  createdAt: string;
}

export function insertProArtifact(input: {
  id: string;
  sessionId?: string;
  runId?: string;
  kind: ProArtifactKind;
  title: string;
  filePath: string;
  mime?: string;
  size?: number;
  meta?: any;
}) {
  try {
    proDb
      .prepare(
        `INSERT INTO pro_artifacts (id, session_id, run_id, kind, title, file_path, mime, size, meta)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.sessionId || null,
        input.runId || null,
        input.kind,
        (input.title || '').slice(0, 120),
        input.filePath,
        input.mime || '',
        input.size || 0,
        JSON.stringify(input.meta || {}),
      );
  } catch (err: any) {
    console.warn('[pro] 产物入库失败:', err?.message || err);
  }
}

function mapArtifact(r: any): ProArtifactRow {
  let meta: any = {};
  try {
    meta = JSON.parse(r.meta || '{}');
  } catch {
    meta = {};
  }
  return {
    id: r.id,
    sessionId: r.session_id,
    runId: r.run_id,
    kind: r.kind,
    title: r.title,
    filePath: r.file_path,
    mime: r.mime,
    size: Number(r.size || 0),
    meta,
    createdAt: r.created_at,
  };
}

export function listProArtifacts(options: { sessionId?: string; kind?: string; limit?: number } = {}) {
  const limit = Math.min(200, Math.max(1, options.limit || 60));
  const where: string[] = [];
  const args: any[] = [];
  if (options.sessionId) {
    where.push('session_id = ?');
    args.push(options.sessionId);
  }
  if (options.kind) {
    where.push('kind = ?');
    args.push(options.kind);
  }
  const sql = `SELECT * FROM pro_artifacts ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, rowid DESC LIMIT ?`;
  const rows = proDb.prepare(sql).all(...args, limit) as any[];
  return rows.map(mapArtifact);
}

export function getProArtifact(id: string): ProArtifactRow | null {
  const row = proDb.prepare('SELECT * FROM pro_artifacts WHERE id = ?').get(id) as any;
  return row ? mapArtifact(row) : null;
}

export function listProArtifactsByRun(runId: string) {
  const rows = proDb.prepare('SELECT * FROM pro_artifacts WHERE run_id = ? ORDER BY created_at ASC, rowid ASC').all(runId) as any[];
  return rows.map(mapArtifact);
}

/** 删除记录（文件由调用方决定是否一并删） */
export function deleteProArtifact(id: string) {
  proDb.prepare('DELETE FROM pro_artifacts WHERE id = ?').run(id);
}

// ===== 审计 / 用量 =====

export function recordProAudit(input: {
  sessionId?: string;
  runId?: string;
  tool: string;
  level: string;
  args?: string;
  status?: string;
  durationMs?: number | null;
}) {
  try {
    proDb
      .prepare('INSERT INTO pro_audit_logs (session_id, run_id, tool, level, args, status, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(
        input.sessionId || null,
        input.runId || null,
        input.tool,
        input.level,
        (input.args || '').slice(0, 400),
        input.status || 'ok',
        input.durationMs ?? null,
      );
  } catch (err: any) {
    console.warn('[pro] 审计写入失败:', err?.message || err);
  }
}

export function recordProUsage(input: {
  sessionId?: string;
  runId?: string;
  model: string;
  inputChars: number;
  outputChars: number;
}) {
  // 中文场景下粗估：约 1 token ≈ 2 字符（只用于分账展示，不作为计费依据）
  const estTokens = Math.round((input.inputChars + input.outputChars) / 2);
  try {
    proDb
      .prepare('INSERT INTO pro_usage (session_id, run_id, model, input_chars, output_chars, est_tokens) VALUES (?, ?, ?, ?, ?, ?)')
      .run(input.sessionId || null, input.runId || null, input.model, input.inputChars, input.outputChars, estTokens);
  } catch (err: any) {
    console.warn('[pro] 用量写入失败:', err?.message || err);
  }
  return estTokens;
}

export function usageSummary() {
  const today = proDb
    .prepare("SELECT COUNT(*) AS runs, COALESCE(SUM(est_tokens), 0) AS tokens FROM pro_usage WHERE date(created_at) = date('now')")
    .get() as any;
  const total = proDb
    .prepare('SELECT COUNT(*) AS runs, COALESCE(SUM(est_tokens), 0) AS tokens FROM pro_usage')
    .get() as any;
  return {
    todayRuns: Number(today?.runs || 0),
    todayTokens: Number(today?.tokens || 0),
    totalRuns: Number(total?.runs || 0),
    totalTokens: Number(total?.tokens || 0),
  };
}
