import { artifactUrl } from '../api';
import type { ProArtifact } from '../types';

function formatSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

const KIND_LABEL: Record<string, string> = {
  image: '图片',
  doc: 'Word',
  html: '设计稿',
  pdf: 'PDF',
  text: '文本',
  other: '文件',
};

/** 会话里的产物卡：图片直接预览，文档/设计稿给缩略提示与打开入口 */
export default function ArtifactCard({
  artifact,
  onOpen,
}: {
  artifact: ProArtifact;
  onOpen?: (artifact: ProArtifact) => void;
}) {
  const url = artifactUrl(artifact.id);
  return (
    <div className={`artifact-card kind-${artifact.kind}`}>
      <div className="artifact-head">
        <span className="artifact-kind">{KIND_LABEL[artifact.kind] || artifact.kind}</span>
        <span className="artifact-title" title={artifact.title}>
          {artifact.title}
        </span>
        <span className="artifact-size">{formatSize(artifact.size)}</span>
      </div>

      {artifact.kind === 'image' ? (
        <button type="button" className="artifact-preview" onClick={() => onOpen?.(artifact)}>
          <img src={url} alt={artifact.title} loading="lazy" />
        </button>
      ) : (
        <div className="artifact-body">
          <span className="artifact-icon">{artifact.kind === 'html' ? '🖥' : artifact.kind === 'doc' ? '📄' : '📎'}</span>
          <div className="artifact-actions">
            <button type="button" className="pro-btn ghost" onClick={() => onOpen?.(artifact)}>
              {artifact.kind === 'html' ? '预览' : '打开'}
            </button>
            <a className="pro-btn ghost" href={url} download={artifact.title} target="_blank" rel="noreferrer">
              下载
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
