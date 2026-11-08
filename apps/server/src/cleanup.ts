import { db } from './db.js';

/**
 * 访客数据保留策略：只清理匿名访客的历史，注册账号的会话保留。
 * 默认保留 180 天，可用 DATA_RETENTION_DAYS 调整（<=0 表示关闭）。
 */
const DEFAULT_RETENTION_DAYS = 180;

export function cleanupGuestData(
  retentionDays = Number(process.env.DATA_RETENTION_DAYS || DEFAULT_RETENTION_DAYS),
): { messages: number; sessions: number } {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return { messages: 0, sessions: 0 };
  const modifier = `-${Math.floor(retentionDays)} days`;

  try {
    const messages = db.prepare(`
      DELETE FROM visitor_messages
      WHERE created_at < datetime('now', ?)
        AND session_id IN (
          SELECT s.id FROM visitor_sessions s
          WHERE s.visitor_id NOT IN (SELECT id FROM visitor_users)
        )
    `).run(modifier);

    const sessions = db.prepare(`
      DELETE FROM visitor_sessions
      WHERE created_at < datetime('now', ?)
        AND visitor_id NOT IN (SELECT id FROM visitor_users)
        AND id NOT IN (SELECT DISTINCT session_id FROM visitor_messages)
    `).run(modifier);

    const removedMessages = Number(messages.changes || 0);
    const removedSessions = Number(sessions.changes || 0);
    if (removedMessages || removedSessions) {
      console.log(`[cleanup] 清理访客数据：消息 ${removedMessages} 条，会话 ${removedSessions} 个`);
    }
    return { messages: removedMessages, sessions: removedSessions };
  } catch (e: any) {
    console.warn('[cleanup] 清理失败:', e?.message || e);
    return { messages: 0, sessions: 0 };
  }
}

/** 启动时跑一次，之后每 24 小时跑一次（定时器不阻塞进程退出） */
export function scheduleGuestDataCleanup() {
  cleanupGuestData();
  const timer = setInterval(() => cleanupGuestData(), 24 * 60 * 60 * 1000);
  timer.unref?.();
}
