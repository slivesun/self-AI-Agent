import { db } from './db.js';

/** 运行时可配置项（存数据库，避免把密钥打进安装包） */
export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? String(row.value) : null;
}

export function setSetting(key: string, value: string | null): void {
  if (value === null || value === '') {
    db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
    return;
  }
  db.prepare(`
    INSERT INTO app_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

/** 知识归档开关：是否允许大模型把这些文档作为知识点分析并用于回答 */
export const KNOWLEDGE_ANSWER_KEY = 'knowledge_answer_enabled';

/** 默认开启（未写入过时为 true），只有显式写入 "0" 才视为关闭 */
export function isKnowledgeAnswerEnabled(): boolean {
  return getSetting(KNOWLEDGE_ANSWER_KEY) !== '0';
}

/** 脱敏展示：只保留首尾各 4 位 */
export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}
