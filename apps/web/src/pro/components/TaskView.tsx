import { useEffect, useState } from 'react';
import { proApi } from '../api';
import type { ProTodo, ProTodoStats, ProTodoStatus } from '../types';

const COLUMNS: { key: ProTodoStatus; label: string; hint: string }[] = [
  { key: 'pending', label: '待办', hint: '还没开始' },
  { key: 'doing', label: '进行中', hint: '正在做' },
  { key: 'done', label: '已完成', hint: '做完了' },
];

/**
 * 任务面板（P4）：三列看板，用户在这里手动增删改，助手通过 todo_set 工具改同一张表。
 * 数据每次进入页面时拉一次，助手改动时会通过 SSE 的 todo 事件让外层刷新。
 */
export default function TaskView({
  reloadKey,
  onAskAssistant,
}: {
  /** 外层传进来的刷新信号（助手改了任务就变一次） */
  reloadKey: number;
  onAskAssistant: (text: string) => void;
}) {
  const [list, setList] = useState<ProTodo[]>([]);
  const [stats, setStats] = useState<ProTodoStats>({ pending: 0, doing: 0, done: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await proApi.listTodos();
      setList(data.list);
      setStats(data.stats);
      setError('');
    } catch (err: any) {
      setError(err?.message || '读取任务失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  const add = async () => {
    const title = draft.trim();
    if (!title) return;
    setAdding(true);
    try {
      const data = await proApi.addTodo(title);
      setList(data.list);
      setStats(data.stats);
      setDraft('');
    } catch (err: any) {
      setError(err?.message || '新增失败');
    } finally {
      setAdding(false);
    }
  };

  const move = async (id: string, status: ProTodoStatus) => {
    try {
      const data = await proApi.updateTodo(id, { status });
      setList(data.list);
      setStats(data.stats);
    } catch (err: any) {
      setError(err?.message || '更新失败');
    }
  };

  const remove = async (id: string) => {
    try {
      const data = await proApi.deleteTodo(id);
      setList(data.list);
      setStats(data.stats);
    } catch (err: any) {
      setError(err?.message || '删除失败');
    }
  };

  const column = (status: ProTodoStatus) => list.filter((t) => t.status === status);

  return (
    <div className="pro-tasks">
      <header className="pro-project-head">
        <div>
          <h1>任务</h1>
          <p>
            待办 {stats.pending} · 进行中 {stats.doing} · 已完成 {stats.done}。这里的任务存在专业版自己的库里；
            你也可以直接跟助手说「把这件事拆成几条待办」，它会用同样的面板记账。
          </p>
        </div>
        <div className="pro-project-actions">
          <button type="button" className="pro-btn ghost" onClick={load} disabled={loading}>
            {loading ? '刷新中…' : '刷新'}
          </button>
        </div>
      </header>

      <div className="pro-task-add">
        <input
          className="pro-input"
          placeholder="新增一条待办，例如：把首页改成深色"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
        />
        <button type="button" className="pro-btn" onClick={add} disabled={adding || !draft.trim()}>
          {adding ? '添加中…' : '添加'}
        </button>
      </div>

      {error ? <div className="pro-task-error">{error}</div> : null}

      {loading ? (
        <div className="pro-project-empty">加载中…</div>
      ) : list.length === 0 ? (
        <div className="pro-project-empty">
          还没有任务。上面加一条，或者在会话里说「帮我把这次重构拆成待办」。
        </div>
      ) : (
        <div className="pro-task-board">
          {COLUMNS.map((col) => (
            <section key={col.key} className={`pro-task-col col-${col.key}`}>
              <div className="pro-task-col-head">
                <span>{col.label}</span>
                <span className="pro-task-col-count">{column(col.key).length}</span>
              </div>
              <div className="pro-task-col-body">
                {column(col.key).length === 0 ? (
                  <div className="pro-task-empty">{col.hint}</div>
                ) : (
                  column(col.key).map((todo) => (
                    <div key={todo.id} className="pro-task-item">
                      <div className="pro-task-title">{todo.title}</div>
                      {todo.note ? <div className="pro-task-note">{todo.note}</div> : null}
                      <div className="pro-task-actions">
                        {todo.status !== 'doing' ? (
                          <button type="button" className="pro-task-link" onClick={() => move(todo.id, 'doing')}>
                            开始
                          </button>
                        ) : null}
                        {todo.status !== 'done' ? (
                          <button type="button" className="pro-task-link" onClick={() => move(todo.id, 'done')}>
                            完成
                          </button>
                        ) : (
                          <button type="button" className="pro-task-link" onClick={() => move(todo.id, 'pending')}>
                            重开
                          </button>
                        )}
                        <button type="button" className="pro-task-link danger" onClick={() => remove(todo.id)}>
                          删除
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      <div className="pro-task-foot">
        <button
          type="button"
          className="pro-btn ghost"
          onClick={() => onAskAssistant('帮我把接下来要做的事拆成几条待办，写进任务面板，再逐条完成。')}
        >
          让助手拆任务
        </button>
      </div>
    </div>
  );
}
