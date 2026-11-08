import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import fs from 'fs';
import { hashPassword } from './password.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 桌面安装包里安装目录是只读的，数据库必须放在用户数据目录；
// 由 Electron 主进程通过 RESUME_DATA_DIR 传入，源码直跑时回退到仓库内 apps/data。
export const DATA_DIR = process.env.RESUME_DATA_DIR
  ? path.resolve(process.env.RESUME_DATA_DIR)
  : path.resolve(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'resume-agent.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');

function generateSlug(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < 10; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'Owner',
      must_change_password INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS personas (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS qa_pairs (
      id TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      variants TEXT NOT NULL DEFAULT '[]',
      answer TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS share_links (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      label TEXT DEFAULT '',
      ref TEXT DEFAULT '',
      require_code INTEGER DEFAULT 0,
      code TEXT,
      expires_at TEXT,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS visitor_sessions (
      id TEXT PRIMARY KEY,
      visitor_id TEXT NOT NULL,
      share_link_id TEXT,
      ip_hash TEXT,
      ua TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS visitor_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      citations TEXT NOT NULL DEFAULT '[]',
      answered INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS unanswered_questions (
      id TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      hit_count INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      last_seen TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS knowledge_docs (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      file_type TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // 运行时配置（模型 Key、模型名等），避免把密钥写进安装包
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // 管理端操作审计（谁在什么时候改了什么接口）
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      status INTEGER,
      ip_hash TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  runMigrations();

  // 老库补列：强制改密标记
  try { db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0'); } catch {}

  // Seed default owner
  const owner = db.prepare('SELECT id FROM users WHERE username = ?').get('admin') as { id: number } | undefined;
  if (!owner) {
    // 默认口令仅用于首次启动；用默认口令创建的账号必须改密后才能使用后台
    const initPassword = (process.env.ADMIN_INIT_PASSWORD || '').trim();
    const password = initPassword || 'admin123';
    const mustChange = initPassword ? 0 : 1;
    db.prepare('INSERT INTO users (username, password_hash, name, must_change_password) VALUES (?, ?, ?, ?)')
      .run('admin', hashPassword(password), 'Owner', mustChange);
    if (!initPassword) {
      console.warn('[db] 已创建默认管理员 admin/admin123，首次登录必须修改密码');
    }
  }

  // Seed default profile (draft + published)
  const profile = db.prepare('SELECT id FROM profiles WHERE id = 1').get() as { id: number } | undefined;
  if (!profile) {
    const defaultProfile = JSON.stringify({
      basics: { name: '你的名字', title: '前端工程师', city: '北京', email: '', phone: '', links: [] },
      summary: '在这里写一段 150-300 字的自我描述。',
      experiences: [], projects: [], skills: [], education: [], extras: {},
      availability: { status: '在职', preferRole: '高级前端工程师', preferCity: '北京' }
    });
    db.prepare('INSERT INTO profiles (id, data) VALUES (1, ?)').run(defaultProfile);
  }
  // 已发布快照表
  db.exec(`
    CREATE TABLE IF NOT EXISTS published_profiles (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  const published = db.prepare('SELECT id FROM published_profiles WHERE id = 1').get() as { id: number } | undefined;
  if (!published) {
    const row = db.prepare('SELECT data FROM profiles WHERE id = 1').get() as any;
    db.prepare('INSERT INTO published_profiles (id, data) VALUES (1, ?)').run(row?.data || '{}');
  }

  // Seed default persona
  const persona = db.prepare('SELECT id FROM personas WHERE id = 1').get() as { id: number } | undefined;
  if (!persona) {
    const defaultPersona = JSON.stringify({
      systemPrompt: '你是个人简历 Agent，代替本人回答面试官的了解性问题。',
      tone: '简洁、务实、不吹嘘；用第一人称；技术问题可以深入。',
      hardConstraint: '只基于资料回答，资料没有就说"我的资料里没有这块，建议直接问我本人"。',
      refusalTopics: ['薪资细节', '离职内情', '前公司未公开信息', '对前同事评价'],
      fallbackReply: '这个问题我不方便代答，建议直接联系本人。',
      temperature: 0.3
    });
    db.prepare('INSERT INTO personas (id, data) VALUES (1, ?)').run(defaultPersona);
  }

  // 访客用户表（注册登录）
  db.exec(`
    CREATE TABLE IF NOT EXISTS visitor_users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nickname TEXT NOT NULL,
      avatar TEXT DEFAULT '0',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  // 旧表加 avatar 列
  try { db.exec(`ALTER TABLE visitor_users ADD COLUMN avatar TEXT DEFAULT '0'`); } catch {}

  // Seed default share link
  const link = db.prepare('SELECT id FROM share_links LIMIT 1').get() as { id: string } | undefined;
  if (!link) {
    db.prepare('INSERT INTO share_links (id, slug, label, ref) VALUES (?, ?, ?, ?)').run(
      crypto.randomUUID(), generateSlug(), '默认链接', 'default'
    );
  }
}

/**
 * 版本化迁移：记录"引入迁移台账之后"的结构变更。
 * 更早的历史结构仍由 initDb 里的 CREATE IF NOT EXISTS 保证幂等。
 * 新增变更请追加到 migrations 数组，不要再散落 try/catch ALTER。
 */
function runMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as any[]).map((r) => Number(r.version)),
  );

  const migrations: { version: number; name: string; up: () => void }[] = [
    {
      version: 1,
      name: 'add-core-indexes',
      up: () => {
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_visitor_messages_session ON visitor_messages(session_id, created_at);
          CREATE INDEX IF NOT EXISTS idx_visitor_sessions_visitor ON visitor_sessions(visitor_id, created_at);
          CREATE INDEX IF NOT EXISTS idx_visitor_messages_role_day ON visitor_messages(role, created_at);
          CREATE INDEX IF NOT EXISTS idx_qa_enabled ON qa_pairs(enabled);
          CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_logs(created_at);
        `);
      },
    },
    {
      version: 2,
      name: 'share-link-index',
      up: () => db.exec('CREATE INDEX IF NOT EXISTS idx_visitor_sessions_link ON visitor_sessions(share_link_id)'),
    },
  ];

  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    m.up();
    db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(m.version);
    console.log(`[db] 迁移已应用：${m.version}-${m.name}`);
  }
}
