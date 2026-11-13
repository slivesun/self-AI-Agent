import { useMemo, useState } from 'react';
import type { ProSession } from '../types';

function formatTime(iso?: string) {
  if (!iso) return '';
  const date = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}/${date.getDate()}`;
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

/** 右侧会话列表：默认 260px，可拖 200–360，可折叠 */
export default function SessionPanel({
  sessions,
  currentId,
  width,
  busy,
  onSelect,
  onCreate,
  onRename,
  onTogglePin,
  onDelete,
  onResize,
  onCollapse,
}: {
  sessions: ProSession[];
  currentId: string;
  width: number;
  busy: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
  onResize: (width: number) => void;
  onCollapse: () => void;
}) {
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editingTitle, setEditingTitle] = useState('');
  const [confirmId, setConfirmId] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => `${s.title} ${s.preview}`.toLowerCase().includes(q));
  }, [sessions, query]);

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const move = (e: PointerEvent) => {
      // 面板在右侧：往左拖 = 变宽
      const next = Math.min(360, Math.max(200, startWidth + (startX - e.clientX)));
      onResize(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('pro-resizing');
    };
    document.body.classList.add('pro-resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const commitRename = (id: string) => {
    const title = editingTitle.trim();
    setEditingId('');
    if (title) onRename(id, title);
  };

  return (
    <aside className="pro-sessions" style={{ width }}>
      <div className="pro-resizer" onPointerDown={startDrag} title="拖动调整宽度" />

      <div className="pro-sessions-head">
        <span className="pro-sessions-title">会话</span>
        <div className="pro-sessions-actions">
          <button type="button" className="pro-icon-btn" title="新建会话" onClick={onCreate} disabled={busy}>
            ＋
          </button>
          <button type="button" className="pro-icon-btn" title="收起列表" onClick={onCollapse}>
            ›
          </button>
        </div>
      </div>

      <div className="pro-sessions-search">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索会话"
          spellCheck={false}
        />
      </div>

      <div className="pro-sessions-list">
        {filtered.length === 0 ? (
          <div className="pro-sessions-empty">{sessions.length ? '没有匹配的会话' : '还没有会话，点右上角 ＋ 开始'}</div>
        ) : (
          filtered.map((session) => {
            const active = session.id === currentId;
            return (
              <div
                key={session.id}
                className={`pro-session-item${active ? ' active' : ''}`}
                onClick={() => {
                  if (editingId) return;
                  onSelect(session.id);
                }}
              >
                <div className="pro-session-main">
                  {editingId === session.id ? (
                    <input
                      className="pro-session-rename"
                      value={editingTitle}
                      autoFocus
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onBlur={() => commitRename(session.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(session.id);
                        if (e.key === 'Escape') setEditingId('');
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <>
                      <div className="pro-session-title">
                        {session.pinned ? <span className="pro-session-pin">★</span> : null}
                        {session.title}
                      </div>
                      <div className="pro-session-preview">{session.preview || '暂无消息'}</div>
                    </>
                  )}
                </div>

                <div className="pro-session-side">
                  <span className="pro-session-time">{formatTime(session.updatedAt)}</span>
                  <div className="pro-session-tools" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      title={session.pinned ? '取消置顶' : '置顶'}
                      onClick={() => onTogglePin(session.id, !session.pinned)}
                    >
                      ★
                    </button>
                    <button
                      type="button"
                      title="重命名"
                      onClick={() => {
                        setEditingId(session.id);
                        setEditingTitle(session.title);
                      }}
                    >
                      ✎
                    </button>
                    <button type="button" title="删除" onClick={() => setConfirmId(session.id)}>
                      ×
                    </button>
                  </div>
                </div>

                {confirmId === session.id ? (
                  <div className="pro-session-confirm" onClick={(e) => e.stopPropagation()}>
                    <span>删除这个会话？</span>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        setConfirmId('');
                        onDelete(session.id);
                      }}
                    >
                      删除
                    </button>
                    <button type="button" onClick={() => setConfirmId('')}>
                      取消
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
