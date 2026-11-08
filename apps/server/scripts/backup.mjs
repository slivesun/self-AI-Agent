/**
 * 数据库备份：先 checkpoint WAL 再把 .db 复制到 backups/。
 * 用法：pnpm --filter @resume-agent/server run backup
 *
 * 数据目录解析与 db.ts 保持一致：RESUME_DATA_DIR 优先，否则仓库内 apps/data。
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.RESUME_DATA_DIR
  ? path.resolve(process.env.RESUME_DATA_DIR)
  : path.resolve(serverRoot, '..', 'data');
const dbPath = path.join(dataDir, 'resume-agent.db');

if (!existsSync(dbPath)) {
  console.error(`数据库不存在：${dbPath}`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
db.close();

const backupDir = path.join(dataDir, 'backups');
mkdirSync(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(backupDir, `resume-agent-${stamp}.db`);
copyFileSync(dbPath, target);

console.log(`备份完成：${target}`);
