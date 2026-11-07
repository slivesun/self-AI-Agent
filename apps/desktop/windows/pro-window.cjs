/**
 * 专业版窗口：独立顶层窗口，加载 /pro 路由。
 *
 * 独立性约束：
 * - 不设置 parent / modal，主窗口最小化、关闭都不会影响它；
 * - 单例，重复点击只聚焦不新开；
 * - 尺寸记忆与主窗口同一套机制，只是状态文件不同。
 */

const { createAppWindow, attachContextMenu } = require('./window-factory.cjs');
const { windowKindArgument } = require('../bridge/channels.cjs');

const MIN_SIZE = { width: 800, height: 600 };
const DEFAULT_SIZE = { width: 1120, height: 760 };
const STATE_FILE = 'pro-window-state.json';
const BACKGROUND = { light: '#ffffff', dark: '#1a1a2e' };

let proWindow = null;

function getProWindow() {
  return proWindow;
}

function normalizeTheme(theme) {
  return theme === 'dark' ? 'dark' : 'light';
}

/**
 * 打开专业版窗口；若已存在则恢复/聚焦。
 * @returns {{ created: boolean, focused: boolean }}
 */
function openProWindow({ BrowserWindow, screen, Menu, icon, userDataDir, url, theme }) {
  if (proWindow && !proWindow.isDestroyed()) {
    if (proWindow.isMinimized()) proWindow.restore();
    proWindow.show();
    proWindow.focus();
    return { created: false, focused: true };
  }

  proWindow = createAppWindow({
    BrowserWindow,
    screen,
    title: '个人AI助手 · 专业版',
    backgroundColor: BACKGROUND[normalizeTheme(theme)],
    icon,
    minSize: MIN_SIZE,
    defaultSize: DEFAULT_SIZE,
    stateFile: STATE_FILE,
    userDataDir,
    kindArg: windowKindArgument('pro'),
  });

  attachContextMenu(proWindow, Menu);

  proWindow.on('closed', () => {
    proWindow = null;
  });

  proWindow.loadURL(url).catch((err) => {
    console.error('[pro-window] load failed:', err && err.message ? err.message : err);
  });

  return { created: true, focused: true };
}

module.exports = {
  MIN_SIZE,
  DEFAULT_SIZE,
  STATE_FILE,
  getProWindow,
  openProWindow,
  normalizeTheme,
};
