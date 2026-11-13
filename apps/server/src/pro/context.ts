/**
 * 上下文预算：历史消息不能无限增长。
 * 做法：从最新往回装，装到预算为止；更早的消息压成一段"早期对话摘要"，
 * 不做 LLM 二次总结（省钱、可控、不会因为摘要再调一次模型而变慢）。
 */

/** 历史预算（字符）：约等于 12000 tokens，为当前请求与工具输出留出空间 */
export const HISTORY_BUDGET_CHARS = 24_000;
const MAX_HISTORY_ITEMS = 10;
const DIGEST_MAX_CHARS = 1_500;
const DIGEST_ITEM_CHARS = 80;
/** 历史里助手长回复的压缩阈值：全文超长就只留头尾，避免每轮重复发送几千字的旧回答 */
const ASSISTANT_KEEP_HEAD = 400;
const ASSISTANT_KEEP_TAIL = 150;
const ASSISTANT_COMPRESS_OVER = 800;

function compressForHistory(msg: HistoryInput): string {
  const content = String(msg.content || '');
  if (msg.role !== 'assistant' || content.length <= ASSISTANT_COMPRESS_OVER) return content;
  const omitted = content.length - ASSISTANT_KEEP_HEAD - ASSISTANT_KEEP_TAIL;
  return `${content.slice(0, ASSISTANT_KEEP_HEAD)}\n…（此处省略 ${omitted} 字）\n${content.slice(-ASSISTANT_KEEP_TAIL)}`;
}

export interface HistoryInput {
  role: 'user' | 'assistant';
  content: string;
}

export function buildHistory(messages: HistoryInput[], budget = HISTORY_BUDGET_CHARS): {
  history: HistoryInput[];
  digest: string;
  droppedCount: number;
} {
  const kept: HistoryInput[] = [];
  let used = 0;
  let dropped = 0;
  const digestParts: string[] = [];

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    const content = compressForHistory(msg);
    const cost = content.length;

    const canKeep = kept.length < MAX_HISTORY_ITEMS && used + cost <= budget;
    if (canKeep) {
      kept.unshift({ role: msg.role, content });
      used += cost;
    } else {
      dropped += 1;
      const label = msg.role === 'user' ? '用户' : '助手';
      const oneLine = content.replace(/\s+/g, ' ').slice(0, DIGEST_ITEM_CHARS);
      if (oneLine) digestParts.unshift(`${label}：${oneLine}`);
    }
  }

  let digest = '';
  if (digestParts.length) {
    let text = `早期对话摘要（自动压缩，共 ${dropped} 条）：\n${digestParts.join('\n')}`;
    if (text.length > DIGEST_MAX_CHARS) text = `${text.slice(0, DIGEST_MAX_CHARS)}…`;
    digest = text;
  }

  return { history: kept, digest, droppedCount: dropped };
}
