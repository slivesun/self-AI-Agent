/**
 * 端（Electron）与渲染层共用的通道常量与窗口类型定义。
 * 主进程（main / ipc）和 preload 都从这里取，避免字符串散落在各处对不上。
 */

const CHANNELS = Object.freeze({
  // 窗口控制：一律以 ipcMain 事件里的 sender 定位窗口，不再假设只有一个主窗口
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_TOGGLE_MAXIMIZE: 'window:toggle-maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',
  WINDOW_MAXIMIZED_CHANGED: 'window:maximized',
  // 专业版窗口
  PRO_OPEN: 'pro:open',
  // 系统目录选择（专业版授权工作区用）
  DIALOG_CHOOSE_DIRECTORY: 'dialog:choose-directory',
});

const WINDOW_KIND = Object.freeze({
  MAIN: 'main',
  PRO: 'pro',
});

/** 通过 additionalArguments 传给 preload 的窗口身份标记 */
const WINDOW_KIND_ARG_PREFIX = '--app-window=';

function windowKindArgument(kind) {
  return `${WINDOW_KIND_ARG_PREFIX}${kind}`;
}

/** 在 preload 的 process.argv 中解析当前窗口身份，解析不出时按主窗口处理 */
function parseWindowKind(argv) {
  if (!Array.isArray(argv)) return WINDOW_KIND.MAIN;
  const hit = argv.find((arg) => typeof arg === 'string' && arg.startsWith(WINDOW_KIND_ARG_PREFIX));
  if (!hit) return WINDOW_KIND.MAIN;
  const kind = hit.slice(WINDOW_KIND_ARG_PREFIX.length);
  return kind === WINDOW_KIND.PRO ? WINDOW_KIND.PRO : WINDOW_KIND.MAIN;
}

module.exports = {
  CHANNELS,
  WINDOW_KIND,
  WINDOW_KIND_ARG_PREFIX,
  windowKindArgument,
  parseWindowKind,
};
