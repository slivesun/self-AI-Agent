/**
 * 公共 JS Bridge 的构造器（只在 preload 里执行）。
 *
 * 设计原则：
 * 1. 渲染层拿到的永远是 window.desktopBridge 这一个命名空间对象，不接触 ipcRenderer；
 * 2. 只暴露按业务分组的窄接口（runtime / window / pro），不提供任意 channel 的 invoke；
 * 3. 返回值统一走 { ok, data?, error? } 的信封，让 React 侧有稳定的错误分支。
 */

const { CHANNELS, WINDOW_KIND, parseWindowKind } = require('./channels.cjs');

function createBridge({ ipcRenderer, argv, platform, appVersion }) {
  if (!ipcRenderer) throw new Error('[bridge] ipcRenderer is required');

  const windowKind = parseWindowKind(argv);

  // 统一的异常兜底：通道不存在、主进程抛错都收敛成信封，渲染层不必 try/catch 每个调用
  const safeInvoke = async (channel, payload) => {
    try {
      const result = await ipcRenderer.invoke(channel, payload);
      if (result && typeof result === 'object' && 'ok' in result) return result;
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : 'unknown error' };
    }
  };

  const bridge = {
    runtime: Object.freeze({
      isDesktop: true,
      windowKind,
      platform: platform || 'unknown',
      appVersion: appVersion || '',
    }),

    window: {
      minimize() {
        ipcRenderer.send(CHANNELS.WINDOW_MINIMIZE);
      },
      toggleMaximize() {
        // 主窗口没配置 maxWidth，这里只是转发意图，真正的判断留在主进程
        ipcRenderer.send(CHANNELS.WINDOW_TOGGLE_MAXIMIZE);
      },
      close() {
        ipcRenderer.send(CHANNELS.WINDOW_CLOSE);
      },
      isMaximized() {
        return safeInvoke(CHANNELS.WINDOW_IS_MAXIMIZED).then((res) =>
          res.ok ? Boolean(res.data) : false,
        );
      },
      /** 只订阅"本窗口"的最大化状态，返回取消订阅函数 */
      onMaximizeChange(callback) {
        if (typeof callback !== 'function') return () => {};
        const handler = (_event, value) => callback(Boolean(value));
        ipcRenderer.on(CHANNELS.WINDOW_MAXIMIZED_CHANGED, handler);
        return () => ipcRenderer.removeListener(CHANNELS.WINDOW_MAXIMIZED_CHANGED, handler);
      },
    },

    pro: {
      /**
       * 打开（或聚焦）专业版窗口。
       * @param {{ theme?: 'light' | 'dark' }} [options] 主题由调用方给出，主进程据此设置窗口底色，避免开窗白闪
       */
      async open(options) {
        const theme = options && options.theme === 'dark' ? 'dark' : 'light';
        const res = await safeInvoke(CHANNELS.PRO_OPEN, { theme });
        if (!res.ok) return { ok: false, error: res.error };
        const data = res.data || {};
        return { ok: true, created: data.created === true, focused: data.focused === true };
      },
    },

    // 系统能力：目前只有目录选择（专业版授权工作区用，普通版不调用）
    dialog: {
      /**
       * 弹系统目录选择框。
       * @param {{ title?: string, defaultPath?: string }} [options]
       * @returns {Promise<{ ok: true, path: string | null } | { ok: false, error: string }>}
       *          用户取消时 path 为 null（不是错误）
       */
      async chooseDirectory(options) {
        const res = await safeInvoke(CHANNELS.DIALOG_CHOOSE_DIRECTORY, {
          title: options && options.title,
          defaultPath: options && options.defaultPath,
        });
        if (!res.ok) return { ok: false, error: res.error };
        const data = res.data || {};
        return { ok: true, path: typeof data.path === 'string' ? data.path : null };
      },
    },
  };

  // 逐层冻结：渲染层无法替换 bridge 上的方法，降低被页面脚本改写的风险
  Object.freeze(bridge.window);
  Object.freeze(bridge.pro);
  Object.freeze(bridge.dialog);
  Object.freeze(bridge);
  return bridge;
}

module.exports = { createBridge, WINDOW_KIND };
