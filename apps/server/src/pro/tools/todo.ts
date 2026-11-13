import type { ToolDef } from './types.js';
import { truncateOutput } from './types.js';
import { listTodos, addTodo, findTodo, updateTodo, deleteTodo, todoStats } from '../todos.js';

/**
 * 任务面板工具（P4）。
 *
 * 这一层只有 R 级：写入的是专业版自己的 pro_todos 表（不改用户任何文件），
 * 但还是要求模型按"list → add → update(done)"的顺序调用，别一口气刷一屏。
 */

function render(list: ReturnType<typeof listTodos>) {
  if (!list.length) return '任务清单是空的。';
  const label: Record<string, string> = { pending: '待办', doing: '进行中', done: '已完成' };
  return list
    .map((t, i) => `${i + 1}. [${label[t.status] || t.status}] ${t.title}${t.note ? `（${t.note}）` : ''}  id=${t.id.slice(0, 8)}`)
    .join('\n');
}

export const todoSet: ToolDef = {
  name: 'todo_set',
  label: '任务清单',
  description:
    '管理专业版里的任务面板（待办 / 进行中 / 完成）。多步骤任务开始前，先用 action=list 看一眼，再用 action=add 拆成 2–6 条可执行项；每完成一步就用 action=update 改状态（status=done）。只动专业版内部的任务表，不改用户文件。',
  level: 'R',
  schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'add', 'update', 'delete'],
        description: 'list 查看 / add 新增 / update 改状态或标题 / delete 删除',
      },
      title: { type: 'string', description: '任务标题（add 必填，update 也可用来改标题）' },
      id: { type: 'string', description: '任务 id 或标题关键词（update / delete 用）' },
      status: { type: 'string', enum: ['pending', 'doing', 'done'], description: 'update 时改成什么状态' },
      note: { type: 'string', description: '备注（可选）' },
    },
    required: ['action'],
  },
  preview: (args) => {
    const action = String(args?.action || 'list');
    if (action === 'add') return `新增任务：${String(args?.title || '').slice(0, 60)}`;
    if (action === 'update') return `更新任务 ${String(args?.id || '').slice(0, 40)} → ${String(args?.status || '')}`;
    if (action === 'delete') return `删除任务 ${String(args?.id || '').slice(0, 40)}`;
    return '查看任务清单';
  },
  async run(args, ctx) {
    const action = String(args?.action || 'list');

    if (action === 'list') {
      const list = listTodos({ limit: 50 });
      const stats = todoStats();
      return truncateOutput(
        `任务清单（共 ${stats.total} 条：待办 ${stats.pending} / 进行中 ${stats.doing} / 完成 ${stats.done}）\n\n${render(list)}`,
      );
    }

    if (action === 'add') {
      const todo = addTodo({ title: String(args?.title || ''), note: String(args?.note || ''), sessionId: ctx.sessionId });
      ctx.emit('todo', { action: 'add', todo });
      return `已加入任务清单：[待办] ${todo.title}  id=${todo.id.slice(0, 8)}\n\n当前清单：\n${render(listTodos({ limit: 50 }))}`;
    }

    if (action === 'update') {
      const key = String(args?.id || args?.title || '');
      const target = findTodo(key);
      if (!target) throw new Error(`找不到任务：${key}。先用 action=list 看看现有 id/标题。`);
      const updated = updateTodo(target.id, {
        title: args?.title !== undefined ? String(args.title) : undefined,
        status: args?.status as any,
        note: args?.note !== undefined ? String(args.note) : undefined,
      });
      ctx.emit('todo', { action: 'update', todo: updated });
      return `已更新：[${updated?.status}] ${updated?.title}\n\n当前清单：\n${render(listTodos({ limit: 50 }))}`;
    }

    if (action === 'delete') {
      const key = String(args?.id || args?.title || '');
      const target = findTodo(key);
      if (!target) throw new Error(`找不到任务：${key}`);
      deleteTodo(target.id);
      ctx.emit('todo', { action: 'delete', id: target.id });
      return `已删除任务：${target.title}\n\n当前清单：\n${render(listTodos({ limit: 50 }))}`;
    }

    throw new Error('action 只能是 list / add / update / delete');
  },
};
