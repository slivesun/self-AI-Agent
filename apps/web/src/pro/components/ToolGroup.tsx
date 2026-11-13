import { useState } from 'react';
import type { ProToolRecord } from '../types';
import ToolCard from './ToolCard';

/**
 * 一轮里所有工具调用的折叠容器：
 * - 执行中：只把"当前这一步"露出来，避免一屏堆满已完成卡片
 * - 结束后：默认收成一行摘要（N 步 + 工具分布 + 总耗时），点开才看全过程
 */
export default function ToolGroup({ tools, streaming }: { tools: ProToolRecord[]; streaming?: boolean }) {
  const [open, setOpen] = useState(false);

  if (!tools.length) return null;

  if (streaming) {
    const last = tools[tools.length - 1];
    const done = tools.filter((t) => t.status !== 'running').length;
    return (
      <div className="tool-group live">
        <div className="tool-group-live">
          <span className={`tool-dot status-${last.status}`} aria-hidden="true" />
          <span className="tool-group-live-text">正在执行：{last.label || last.name}</span>
          <span className="tool-group-count">已完成 {done} 步</span>
        </div>
        <div className="tool-stack">{<ToolCard tool={last} />}</div>
      </div>
    );
  }

  const counts = new Map<string, number>();
  for (const tool of tools) {
    const key = tool.label || tool.name;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const summary = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, n]) => `${name} ${n}`)
    .join(' · ');

  const totalMs = tools.reduce((sum, t) => sum + (t.durationMs || 0), 0);

  return (
    <div className="tool-group">
      <button type="button" className="tool-group-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="tool-group-icon" aria-hidden="true">
          ⚙
        </span>
        <span className="tool-group-title">执行过程</span>
        <span className="tool-group-count">
          {tools.length} 步{summary ? ` · ${summary}` : ''}
        </span>
        {totalMs ? <span className="tool-group-dur">{totalMs >= 1000 ? `${(totalMs / 1000).toFixed(1)}s` : `${totalMs}ms`}</span> : null}
        <span className={`tool-caret${open ? ' open' : ''}`} aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div className="tool-stack">
          {tools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
