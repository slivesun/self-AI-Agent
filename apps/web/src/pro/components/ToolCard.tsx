import { useState } from 'react';
import type { ProToolRecord } from '../types';

const LEVEL_LABEL: Record<string, string> = { R: '读取', W: '写入', X: '执行' };

/** 一次工具调用的卡片：状态点 + 名称 + 级别 + 耗时，点开看参数与结果 */
export default function ToolCard({ tool }: { tool: ProToolRecord }) {
  const [open, setOpen] = useState(false);
  const statusText =
    tool.status === 'running' ? '执行中' : tool.status === 'ok' ? '完成' : tool.status === 'denied' ? '已拒绝' : '失败';

  return (
    <div className={`tool-card status-${tool.status}`}>
      <button type="button" className="tool-card-head" onClick={() => setOpen((v) => !v)}>
        <span className={`tool-dot status-${tool.status}`} aria-hidden="true" />
        <span className="tool-name">{tool.label || tool.name}</span>
        <span className={`tool-level level-${tool.level}`}>{LEVEL_LABEL[tool.level] || tool.level}</span>
        <span className="tool-status">{statusText}</span>
        {typeof tool.durationMs === 'number' && tool.status !== 'running' ? (
          <span className="tool-dur">{tool.durationMs}ms</span>
        ) : null}
        <span className={`tool-caret${open ? ' open' : ''}`} aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div className="tool-card-body">
          <div className="tool-block">
            <div className="tool-block-title">参数</div>
            <pre className="tool-pre">{tool.args || '（无）'}</pre>
          </div>
          {tool.result ? (
            <div className="tool-block">
              <div className="tool-block-title">{tool.status === 'error' ? '错误' : '结果'}</div>
              <pre className="tool-pre">{tool.result}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
      {tool.output ? (
        <div className="tool-live">
          <div className="tool-block-title">实时输出</div>
          <pre className="tool-pre live">{tool.output}</pre>
        </div>
      ) : null}
    </div>
  );
}
