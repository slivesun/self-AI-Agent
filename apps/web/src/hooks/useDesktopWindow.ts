import { useEffect, useState } from 'react';
import { desktopBridge } from '../bridge';

/**
 * 订阅"当前窗口"的最大化状态（通过公共 JS Bridge）。
 * 非桌面环境下始终返回 false，页面按普通浏览器渲染。
 */
export function useMaximizedState(): boolean {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!desktopBridge) return;
    let alive = true;

    desktopBridge.window
      .isMaximized()
      .then((value) => { if (alive) setMaximized(value); })
      .catch(() => {});

    const off = desktopBridge.window.onMaximizeChange((value) => {
      if (alive) setMaximized(value);
    });

    return () => {
      alive = false;
      off();
    };
  }, []);

  return maximized;
}
