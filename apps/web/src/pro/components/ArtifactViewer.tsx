import { useEffect } from 'react';
import { artifactUrl } from '../api';
import type { ProArtifact } from '../types';

/** 产物查看器：图片放大看、HTML 用 iframe 预览、PDF 内嵌、Word 只能下载 */
export default function ArtifactViewer({
  artifact,
  onClose,
}: {
  artifact: ProArtifact | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!artifact) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [artifact, onClose]);

  if (!artifact) return null;
  const url = artifactUrl(artifact.id);

  return (
    <div className="artifact-viewer" onClick={onClose}>
      <div className={`artifact-viewer-box kind-${artifact.kind}`} onClick={(e) => e.stopPropagation()}>
        <div className="artifact-viewer-head">
          <span className="artifact-viewer-title">{artifact.title}</span>
          <div className="artifact-viewer-actions">
            <a className="pro-btn ghost" href={url} download={artifact.title} target="_blank" rel="noreferrer">
              下载
            </a>
            <button type="button" className="pro-btn ghost" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>

        {artifact.kind === 'image' ? (
          <div className="artifact-viewer-image">
            <img src={url} alt={artifact.title} />
          </div>
        ) : artifact.kind === 'html' ? (
          <iframe className="artifact-viewer-frame" src={url} title={artifact.title} sandbox="allow-same-origin" />
        ) : artifact.kind === 'pdf' ? (
          <iframe className="artifact-viewer-frame" src={url} title={artifact.title} />
        ) : (
          <div className="artifact-viewer-fallback">
            <p>这个格式不能在窗口里预览，点上方「下载」用本机应用打开。</p>
            <p className="artifact-viewer-path">{artifact.filePath || ''}</p>
          </div>
        )}
      </div>
    </div>
  );
}
