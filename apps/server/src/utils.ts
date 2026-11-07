import crypto from 'crypto';

export function generateSlug(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < 10; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

/** 解析 LLM 回答中的 [来源:xxx] 引用标记，返回清理后的文本和引用列表 */
export function parseCitations(answer: string): { clean: string; citations: { type: string; id: string; label: string }[] } {
  const matches = [...answer.matchAll(/\[来源:([^\]]+)\]/g)];
  const citations = matches.map(m => ({ type: 'doc', id: m[1], label: m[1] }));
  const clean = answer.replace(/\[来源:[^\]]+\]/g, '').trim();
  return { clean, citations };
}

/** 从 multer 文件名修复中文乱码 */
export function fixFilename(original: string): string {
  try { return Buffer.from(original, 'latin1').toString('utf8'); } catch { return original; }
}
