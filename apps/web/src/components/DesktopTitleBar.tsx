import { useEffect, useState } from 'react';
import BrandMark from './BrandMark';

type DesktopApi = {
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;
  onMaximizeChange: (cb: (value: boolean) => void) => () => void;
};

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}

/**
 * Electron 自绘标题栏：仅在桌面端（preload 注入了 window.desktop）渲染，浏览器里不出现
 */
export default function DesktopTitleBar() {
  const desktop = typeof window !== 'undefined' ? window.desktop : undefined;
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    desktop.isMaximized().then((v) => alive && setMaximized(v)).catch(() => {});
    const off = desktop.onMaximizeChange(setMaximized);
    return () => {
      alive = false;
      off?.();
    };
  }, [desktop]);

  if (!desktop) return null;

  return (
    <div className="titlebar">
      <div className="titlebar-drag">
        <BrandMark size={18} className="titlebar-mark" />
        <span className="titlebar-title">个人AI助手</span>
      </div>

      <div className="titlebar-actions">
        <button className="tb-btn" onClick={desktop.minimize} title="最小化" aria-label="最小化">
          <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
            <rect x="0.5" y="5.5" width="11" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          className="tb-btn"
          onClick={desktop.toggleMaximize}
          title={maximized ? '还原' : '最大化'}
          aria-label={maximized ? '还原' : '最大化'}
        >
          {maximized ? (
            <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
              <rect x="3.5" y="0.5" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1" />
              <rect x="0.5" y="3.5" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
              <rect x="0.5" y="0.5" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          )}
        </button>
        <button className="tb-btn tb-close" onClick={desktop.close} title="关闭" aria-label="关闭">
          <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
            <path d="M0.8 0.8 L11.2 11.2 M11.2 0.8 L0.8 11.2" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
