import { useEffect } from 'react';
import BrandMark from './BrandMark';
import { desktopBridge, isDesktop, isProWindow } from '../bridge';
import { useMaximizedState } from '../hooks/useDesktopWindow';

/**
 * Electron 自绘标题栏：仅在桌面端（preload 注入了 window.desktopBridge）渲染，浏览器里不出现。
 * 主窗口与专业版窗口共用同一套外观，差异只在标题文字与 PRO 标识。
 */
export default function DesktopTitleBar() {
  const maximized = useMaximizedState();

  const title = isProWindow ? '个人AI助手 · 专业版' : '个人AI助手';

  // 窗口标题随窗口身份变化（BrowserWindow.title 会被 document.title 覆盖）
  useEffect(() => {
    if (!isDesktop) return;
    document.title = title;
  }, [title]);

  if (!desktopBridge) return null;

  const api = desktopBridge.window;

  return (
    <div className="titlebar">
      <div className="titlebar-drag">
        <BrandMark size={18} className="titlebar-mark" />
        <span className="titlebar-title">{title}</span>
        {isProWindow && <span className="titlebar-badge">PRO</span>}
      </div>

      <div className="titlebar-actions">
        <button className="tb-btn" onClick={() => api.minimize()} title="最小化" aria-label="最小化">
          <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
            <rect x="0.5" y="5.5" width="11" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          className="tb-btn"
          onClick={() => api.toggleMaximize()}
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
        <button className="tb-btn tb-close" onClick={() => api.close()} title="关闭" aria-label="关闭">
          <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
            <path d="M0.8 0.8 L11.2 11.2 M11.2 0.8 L0.8 11.2" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
