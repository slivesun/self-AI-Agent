import type { ToolDef } from './types.js';
import { rollbackChange } from '../changes.js';
import { listProChanges } from '../db.js';

/** 回滚一次改动（P2：让"说一句撤销刚才的修改"真的能撤销） */
export const fsRestore: ToolDef = {
  name: 'fs_restore',
  label: '回滚改动',
  description:
    '把某一次写文件操作回滚到改动前（用系统自动备份恢复；如果是新建的文件则删除）。参数 changeId 来自改动清单里的 id；也可以传 action="list" 先列出本会话的改动清单再决定。',
  level: 'W',
  schema: {
    type: 'object',
    properties: {
      changeId: { type: 'string', description: '改动 id（写入结果里会给出）' },
      list: { type: 'boolean', description: '为 true 时只列出本会话最近的改动清单，不做回滚' },
    },
  },
  preview: (args) => (args?.list ? '查看本会话改动清单' : `回滚改动 ${args?.changeId || '（未指定）'}`),
  async run(args, ctx) {
    if (args?.list) {
      const rows = listProChanges({ sessionId: ctx.sessionId, limit: 20 });
      if (!rows.length) return '本会话还没有任何写文件操作。';
      return rows
        .map(
          (r) =>
            `${r.id} | ${r.rolledBackAt ? '已回滚' : '未回滚'} | ${r.action} | ${r.filePath} | ${r.createdAt}`,
        )
        .join('\n');
    }

    const changeId = String(args?.changeId || '').trim();
    if (!changeId) throw new Error('缺少 changeId（可先传 list=true 查看清单）');

    const result = await rollbackChange(changeId);
    ctx.emit('change_rolled_back', { changeId, filePath: result.filePath });
    return `已回滚：${result.filePath} — ${result.message}`;
  },
};
