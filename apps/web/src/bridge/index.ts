/**
 * 端（Electron）公共 JS Bridge 的渲染层入口。
 *
 * 约定：
 * - 桌面端：window.desktopBridge 由 preload 注入，具备 runtime / window / pro 三个命名空间；
 * - 浏览器端：window.desktopBridge 不存在，isDesktop 为 false，页面必须自行降级（不渲染端专属入口）。
 *
 * 这里只做"能力获取 + 类型约束"，不写业务逻辑，避免各页面各自去摸 window 上的对象。
 */

export type WindowKind = 'main' | 'pro';
export type ThemeMode = 'light' | 'dark';

export type ProOpenResult =
  | { ok: true; created: boolean; focused: boolean }
  | { ok: false; error: string };

type Unsubscribe = () => void;

export interface DesktopBridge {
  runtime: {
    isDesktop: true;
    windowKind: WindowKind;
    platform: string;
    appVersion: string;
  };
  window: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
    isMaximized(): Promise<boolean>;
    onMaximizeChange(callback: (maximized: boolean) => void): Unsubscribe;
  };
  pro: {
    open(options?: { theme?: ThemeMode }): Promise<ProOpenResult>;
  };
  /** 系统能力；浏览器端恒为 undefined，页面必须降级成手填路径 */
  dialog?: {
    chooseDirectory(options?: {
      title?: string;
      defaultPath?: string;
    }): Promise<{ ok: true; path: string | null } | { ok: false; error: string }>;
  };
}

declare global {
  interface Window {
    desktopBridge?: DesktopBridge;
  }
}

function resolveBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const candidate = window.desktopBridge;
  if (!candidate || !candidate.runtime || candidate.runtime.isDesktop !== true) return null;
  return candidate;
}

export const desktopBridge: DesktopBridge | null = resolveBridge();

/** 是否运行在 Electron 桌面端（决定端专属入口是否渲染） */
export const isDesktop = desktopBridge !== null;

/** 当前窗口身份：主窗口 / 专业版窗口 */
export const currentWindowKind: WindowKind = desktopBridge?.runtime.windowKind ?? 'main';

export const isProWindow = currentWindowKind === 'pro';

/**
 * 打开专业版窗口（仅桌面端可用）。
 * 返回 false 表示当前不是桌面环境或主进程拒绝，调用方可据此提示用户。
 */
export async function openProWindow(theme: ThemeMode): Promise<ProOpenResult> {
  if (!desktopBridge) return { ok: false, error: '当前环境不支持专业版窗口' };
  return desktopBridge.pro.open({ theme });
}
