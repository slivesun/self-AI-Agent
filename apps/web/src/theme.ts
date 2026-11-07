/**
 * 主题：读写 localStorage 里的 ra_dark，并把结果同步到 <html class="dark">。
 *
 * 跨窗口一致性说明：
 * 主窗口与专业版窗口同属一个渲染 origin/session，localStorage 与 storage 事件是共享的
 * ——本窗口切换主题后，另一个窗口会收到 storage 事件并跟随切换（storage 事件不会在
 * 修改方自身触发，因此本地状态由 setState 驱动，不会来回抖动）。
 */

import { useCallback, useEffect, useState } from 'react';

export const DARK_STORAGE_KEY = 'ra_dark';

export type ThemeMode = 'light' | 'dark';

export function readDarkPreference(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(DARK_STORAGE_KEY) === '1';
}

export function applyDarkClass(dark: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', dark);
}

export function themeMode(dark: boolean): ThemeMode {
  return dark ? 'dark' : 'light';
}

/**
 * 统一主题 hook：首次进入即应用当前偏好，并监听其他窗口的主题变化。
 * @param options.sync 是否跨窗口同步（专业版窗口需要，主窗口同样需要）
 */
export function useTheme(options: { sync?: boolean } = {}) {
  const { sync = true } = options;
  const [dark, setDark] = useState<boolean>(() => readDarkPreference());

  // 首次挂载先对齐一次：localStorage 可能已被另一个窗口改过
  useEffect(() => {
    const initial = readDarkPreference();
    setDark((prev) => (prev === initial ? prev : initial));
  }, []);

  useEffect(() => {
    applyDarkClass(dark);
    const next = dark ? '1' : '0';
    // 值没变就不写，避免两个窗口互相触发 storage 事件
    if (localStorage.getItem(DARK_STORAGE_KEY) !== next) {
      localStorage.setItem(DARK_STORAGE_KEY, next);
    }
  }, [dark]);

  useEffect(() => {
    if (!sync) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== DARK_STORAGE_KEY) return;
      const next = event.newValue === '1';
      setDark((prev) => (prev === next ? prev : next));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [sync]);

  const toggle = useCallback(() => setDark((prev) => !prev), []);

  return { dark, setDark, toggle, mode: themeMode(dark) };
}
