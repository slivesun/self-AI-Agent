/**
 * 主窗口：会话页（/c/:slug）。与专业版窗口完全独立。
 *
 * 加载职责说明：窗口创建时可以直接 loadURL，也可以 deferLoad 由调用方在后端就绪后再加载
 * （首次启动需要等后端起来再加载，托盘重建时后端已在运行，直接加载）。
 */

const { createAppWindow, attachContextMenu } = require('./window-factory.cjs');
const { windowKindArgument } = require('../bridge/channels.cjs');

const MIN_SIZE = { width: 800, height: 600 };
const STATE_FILE = 'window-state.json';

let mainWindow = null;

function getMainWindow() {
  return mainWindow;
}

/**
 * 创建（或复用）主窗口。已存在时只做显示与聚焦，不重复开窗、不重复加载。
 * @param {object} options
 * @param {string} options.url       主窗口要加载的地址
 * @param {boolean} [options.deferLoad] 为 true 时不在创建阶段加载，由调用方稍后 loadURL
 * @returns {import('electron').BrowserWindow}
 */
function createMainWindow(options) {
  const { BrowserWindow, screen, Menu, icon, userDataDir, url, deferLoad = false } = options;

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = createAppWindow({
    BrowserWindow,
    screen,
    title: '个人AI助手',
    backgroundColor: '#ffffff',
    icon,
    minSize: MIN_SIZE,
    defaultSize: MIN_SIZE,
    stateFile: STATE_FILE,
    userDataDir,
    kindArg: windowKindArgument('main'),
  });

  attachContextMenu(mainWindow, Menu);

  // 引用必须及时释放：主窗口关闭后仍被专业版窗口"养着"，托盘需要能重建它
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (url && !deferLoad) {
    mainWindow.loadURL(url).catch((err) => {
      console.error('[main-window] load failed:', err && err.message ? err.message : err);
    });
  }

  return mainWindow;
}

/** 托盘/激活入口：窗口被关闭过就重建（重建时直接加载页面） */
function showMainWindow(options) {
  return createMainWindow(options);
}

module.exports = { MIN_SIZE, STATE_FILE, getMainWindow, createMainWindow, showMainWindow };
