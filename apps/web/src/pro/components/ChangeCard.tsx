import { useState } from 'react';
import type { ProChange } from '../types';

const ACTION_LABEL: Record<string, string> = {
  create: '新建',
  edit: '修改',
  overwrite: '覆盖',
  delete: '删除',
};

/** 一次落盘改动：文件 + 红绿 diff + 一键回滚 */
export default function ChangeCard({
  change,
  onRollback,
}: {
  change: ProChange;
  onRollback: (changeId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const lines = change.diff ? change.diff.split('\n').filter((l) => !l.startsWith('--- ') && !l.startsWith('+++ ')) : [];
  const rolledBack = Boolean(change.rolledBackAt);
  const visible = open ? lines : lines.slice(0, 8);
  const hidden = lines.length - visible.length;

  const rollback = async () => {
    setBusy(true);
    try {
      await onRollback(change.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`change-card${rolledBack ? ' rolled-back' : ''}`}>
      <div className="change-head">
        <span className="change-action">{ACTION_LABEL[change.action] || change.action}</span>
        <span className="change-path" title={change.filePath}>
          {change.filePath}
        </span>
        {lines.length ? (
          <button type="button" className="change-toggle" onClick={() => setOpen((v) => !v)}>
            {open ? '收起' : `展开 ${lines.length} 行`}
          </button>
        ) : null}
        {rolledBack ? (
          <span className="change-rolled">已回滚（{change.rolledBackAt}）</span>
        ) : (
          <button type="button" className="change-rollback" onClick={rollback} disabled={busy}>
            {busy ? '回滚中…' : '一键回滚'}
          </button>
        )}
      </div>

      {visible.length ? (
        <pre className="change-diff">
          {visible.map((line, i) => {
            const cls = line.startsWith('@@')
              ? 'diff-hunk'
              : line.startsWith('+')
                ? 'diff-add'
                : line.startsWith('-')
                  ? 'diff-del'
                  : 'diff-ctx';
            return (
              <span key={`${i}-${line.slice(0, 8)}`} className={cls}>
                {line || ' '}
                {'\n'}
              </span>
            );
          })}
        </pre>
      ) : (
        <div className="change-note">（新文件或 diff 为空，内容见工具结果）</div>
      )}

      {hidden > 0 ? (
        <button type="button" className="change-more" onClick={() => setOpen(true)}>
          …还有 {hidden} 行
        </button>
      ) : null}
    </div>
  );
}
