import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../data/resume-agent.db');

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

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
      name TEXT NOT NULL DEFAULT 'Owner'
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

  // Seed default owner
  const owner = db.prepare('SELECT id FROM users WHERE username = ?').get('admin') as { id: number } | undefined;
  if (!owner) {
    const hash = crypto.createHash('sha256').update('admin123').digest('hex');
    db.prepare('INSERT INTO users (username, password_hash, name) VALUES (?, ?, ?)').run('admin', hash, 'Owner');
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
