import type { ProPermissionRequest } from '../types';

/** 内联权限确认卡：写文件 / 执行命令前必须由用户点一次 */
export default function PermissionCard({
  request,
  onDecide,
  disabled,
}: {
  request: ProPermissionRequest;
  onDecide: (decision: 'once' | 'session' | 'deny') => void;
  disabled?: boolean;
}) {
  const decided = request.status !== 'pending';

  return (
    <div className={`perm-card${decided ? ' decided' : ''}`}>
      <div className="perm-head">
        <span className="perm-badge">需要确认</span>
        <span className="perm-tool">{request.tool}</span>
      </div>
      <div className="perm-desc">{request.preview}</div>
      {request.args ? <pre className="perm-args">{request.args}</pre> : null}

      {request.status === 'pending' ? (
        <div className="perm-actions">
          <button type="button" className="perm-btn primary" disabled={disabled} onClick={() => onDecide('once')}>
            允许一次
          </button>
          <button type="button" className="perm-btn ghost" disabled={disabled} onClick={() => onDecide('session')}>
            本会话允许
          </button>
          <button type="button" className="perm-btn danger" disabled={disabled} onClick={() => onDecide('deny')}>
            拒绝
          </button>
        </div>
      ) : (
        <div className={`perm-result ${request.status}`}>
          {request.status === 'allowed' ? '已允许，正在执行' : '已拒绝，助手已停止该操作'}
        </div>
      )}
    </div>
  );
}
