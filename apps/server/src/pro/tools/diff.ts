/**
 * 轻量 unified diff：不引第三方 diff 库。
 *
 * 做法：整文件逐行比较，先砍掉公共前缀/后缀行，只把真正变化的区间做成 hunk，
 * 前后各带 context 行。代码编辑这类"局部改动"能给出干净的小 hunk；
 * 多处散落改动会合成一个大 hunk（可接受，界面按折叠展示）。
 */

const MAX_DIFF_LINES = 400;

function toLines(text: string): string[] {
  if (!text) return [];
  return text.replace(/\r\n/g, '\n').split('\n');
}

export function unifiedDiff(before: string, after: string, filePath: string, context = 3): string {
  if (before === after) return '';

  const a = toLines(before);
  const b = toLines(after);

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const aStart = Math.max(0, prefix - context);
  const bStart = Math.max(0, prefix - context);
  const aEnd = Math.min(a.length, a.length - suffix + context);
  const bEnd = Math.min(b.length, b.length - suffix + context);

  const aCount = aEnd - aStart;
  const bCount = bEnd - bStart;

  const lines: string[] = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -${aStart + 1},${aCount} +${bStart + 1},${bCount} @@`,
  ];

  // 前缀上下文
  for (let i = aStart; i < prefix; i += 1) lines.push(` ${a[i]}`);

  // 变化区间
  const removed = a.slice(prefix, a.length - suffix);
  const added = b.slice(prefix, b.length - suffix);
  for (const line of removed) lines.push(`-${line}`);
  for (const line of added) lines.push(`+${line}`);

  // 后缀上下文
  for (let i = a.length - suffix; i < aEnd; i += 1) lines.push(` ${a[i]}`);

  if (lines.length > MAX_DIFF_LINES) {
    const head = lines.slice(0, MAX_DIFF_LINES - 20);
    return `${head.join('\n')}\n…（diff 过长已截断，原文件 ${a.length} 行 → ${b.length} 行）`;
  }
  return lines.join('\n');
}

/** 给界面用的统计：新增/删除行数 */
export function diffStats(diff: string) {
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added += 1;
    else if (line.startsWith('-')) removed += 1;
  }
  return { added, removed };
}
