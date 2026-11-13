import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../db.js';

/**
 * 专业版数据根目录：与普通版（DATA_DIR 下的 resume-agent.db / 知识文档等）物理分开。
 * 隔离口径：模型 Key、登录账号共用；会话、工作区、产物、备份、审计全部独立。
 */
export const PRO_DIR = path.join(DATA_DIR, 'pro');
export const PRO_DB_PATH = path.join(PRO_DIR, 'pro.db');
export const PRO_UPLOADS_DIR = path.join(PRO_DIR, 'uploads');
export const PRO_ARTIFACTS_DIR = path.join(PRO_DIR, 'artifacts');
export const PRO_BACKUPS_DIR = path.join(PRO_DIR, 'backups');

for (const dir of [PRO_DIR, PRO_UPLOADS_DIR, PRO_ARTIFACTS_DIR, PRO_BACKUPS_DIR]) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (err: any) {
    console.warn('[pro] 创建专业版数据目录失败:', dir, err?.message || err);
  }
}
