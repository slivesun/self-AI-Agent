import { useState } from 'react';
import type { ProArtifact } from '../types';
import ArtifactCard from './ArtifactCard';

const FILTERS = [
  { key: '', label: '全部' },
  { key: 'image', label: '图片' },
  { key: 'doc', label: 'Word' },
  { key: 'html', label: '设计稿' },
  { key: 'pdf', label: 'PDF' },
];

/** 素材库（P3）：产物画廊，支持筛选、预览、下载、删除、加入会话 */
export default function AssetsView({
  artifacts,
  loading,
  onFilterChange,
  filter,
  onOpenArtifact,
  onDeleteArtifact,
  onRefresh,
  onUseInChat,
}: {
  artifacts: ProArtifact[];
  loading: boolean;
  filter: string;
  onFilterChange: (kind: string) => void;
  onOpenArtifact: (artifact: ProArtifact) => void;
  onDeleteArtifact: (id: string) => Promise<void>;
  onRefresh: () => void;
  onUseInChat: (artifact: ProArtifact) => void;
}) {
  const [confirmId, setConfirmId] = useState('');
  const [busyId, setBusyId] = useState('');

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      await onDeleteArtifact(id);
      setConfirmId('');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="pro-assets">
      <header className="pro-project-head">
        <div>
          <h1>素材</h1>
          <p>助手生成的图片、Word、设计稿都在这里；文件统一存在专业版自己的产物目录，与普通版互不影响。</p>
        </div>
        <div className="pro-project-actions">
          <button type="button" className="pro-btn ghost" onClick={onRefresh} disabled={loading}>
            {loading ? '刷新中…' : '刷新'}
          </button>
        </div>
      </header>

      <div className="pro-assets-filters">
        {FILTERS.map((item) => (
          <button
            key={item.key || 'all'}
            type="button"
            className={`pro-chip clickable${filter === item.key ? ' active' : ''}`}
            onClick={() => onFilterChange(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="pro-project-empty">加载中…</div>
      ) : artifacts.length === 0 ? (
        <div className="pro-project-empty">
          还没有产物。去「创作」或直接跟助手说「画一张图 / 导出一份 Word」，生成后会自动出现在这里。
        </div>
      ) : (
        <div className="artifact-grid">
          {artifacts.map((item) => (
            <div key={item.id} className="artifact-cell">
              <ArtifactCard artifact={item} onOpen={onOpenArtifact} />
              <div className="artifact-cell-foot">
                <span className="artifact-cell-time">{item.createdAt || ''}</span>
                {confirmId === item.id ? (
                  <span className="artifact-confirm">
                    确认删除？
                    <button type="button" className="artifact-del" onClick={() => remove(item.id)} disabled={busyId === item.id}>
                      {busyId === item.id ? '删除中…' : '是'}
                    </button>
                    <button type="button" className="artifact-cancel" onClick={() => setConfirmId('')}>
                      取消
                    </button>
                  </span>
                ) : (
                  <span className="artifact-cell-actions">
                    <button type="button" className="artifact-link" onClick={() => onUseInChat(item)}>
                      加入会话
                    </button>
                    <button type="button" className="artifact-link danger" onClick={() => setConfirmId(item.id)}>
                      删除
                    </button>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
