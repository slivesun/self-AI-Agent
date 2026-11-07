/**
 * 应用内所有 BrowserWindow 的统一工厂。
 *
 * 目的：主窗口与专业版窗口共用同一套「基础设置」——无系统标题栏、自绘标题栏、
 * 最小尺寸、背景色、窗口尺寸记忆、右键菜单、最大化状态通知，避免两套参数漂移。
 */

const path = require('path');
const { CHANNELS } = require('../bridge/channels.cjs');
const { readWindowState, clampToScreen, writeWindowState } = require('./window-state.cjs');

const PRELOAD_PATH = path.join(__dirname, '..', 'preload.cjs');
const SAVE_STATE_DELAY = 400;

/**
 * @param {object} options
 * @param {import('electron').BrowserWindow} options.BrowserWindow
 * @param {import('electron').Screen} options.screen
 * @param {string} options.kind            'main' | 'pro'
 * @param {string} options.title
 * @param {string} options.backgroundColor 与页面主题一致的底色，避免开窗/拖拽露黑
 * @param {string} options.icon
 * @param {{ width: number, height: number }} options.minSize
 * @param {{ width: number, height: number }} options.defaultSize
 * @param {string} options.stateFile       尺寸记忆文件名
 * @param {string} options.userDataDir
 * @param {string} options.kindArg         传给 preload 的窗口身份参数
 */
function createAppWindow(options) {
  const {
    BrowserWindow, screen, title, backgroundColor, icon,
    minSize, defaultSize, stateFile, userDataDir, kindArg,
  } = options;

  const saved = readWindowState(userDataDir, stateFile);
  const initial = clampToScreen(
    saved || { width: defaultSize.width, height: defaultSize.height, maximized: false },
    screen,
    minSize.width,
    minSize.height,
  );

  const win = new BrowserWindow({
    width: initial.width,
    height: initial.height,
    minWidth: minSize.width,
    minHeight: minSize.height,
    center: true,
    autoHideMenuBar: true,
    title,
    icon,
    backgroundColor,
    show: true,
    // 去掉系统标题栏，改用页面内自绘标题栏
    frame: false,
    // 保留系统边框，防止调整大小时丢窗口
    thickFrame: true,
    // 显式设置不透明，防止拖拽时出现透明黑色残影
    transparent: false,
    opacity: 1.0,
    // 窗口初始隐藏时也绘制内容，避免加载前拖拽露黑
    paintWhenInitiallyHidden: true,
    // 专业版窗口不设 parent / modal：主窗口最小化或关闭都不会带走它
    webPreferences: {
      preload: PRELOAD_PATH,
      nodeIntegration: false,
      // 页面依旧拿不到 Node 能力（contextIsolation 隔离）；
      // 但 preload 需要 require 端内的公共 bridge 模块，而沙箱化 preload 只允许 require('electron')，
      // 因此这里显式关闭 sandbox，否则 bridge 会加载失败、自绘标题栏直接消失。
      sandbox: false,
      contextIsolation: true,
      backgroundColor,
      additionalArguments: kindArg ? [kindArg] : [],
    },
  });

  win.setBackgroundColor(backgroundColor);
  if (initial.maximized) win.maximize();

  // 尺寸记忆：拖拽/最大化变化时节流写盘，关闭前立刻写一次
  let saveTimer = null;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => writeWindowState(userDataDir, stateFile, win), SAVE_STATE_DELAY);
  };
  win.on('resize', scheduleSave);
  win.on('maximize', scheduleSave);
  win.on('unmaximize', scheduleSave);
  win.on('close', () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    writeWindowState(userDataDir, stateFile, win);
  });

  // 最大化状态只通知"本窗口"，否则专业版窗口会收到主窗口的状态
  const notifyMaximized = (value) => {
    if (!win.isDestroyed()) win.webContents.send(CHANNELS.WINDOW_MAXIMIZED_CHANGED, value);
  };
  win.on('maximize', () => notifyMaximized(true));
  win.on('unmaximize', () => notifyMaximized(false));

  return win;
}

/**
 * 右键菜单：刷新 + 检查元素（检查元素走独立窗口，避免挤占页面布局）
 */
function attachContextMenu(win, Menu) {
  const menu = Menu.buildFromTemplate([
    { label: '刷新', role: 'reload' },
    {
      label: '检查元素',
      click: () => {
        if (!win.isDestroyed()) win.webContents.openDevTools({ mode: 'detach' });
      },
    },
  ]);
  win.webContents.on('context-menu', () => {
    if (!win.isDestroyed()) menu.popup({ window: win });
  });
}

module.exports = { createAppWindow, attachContextMenu, PRELOAD_PATH };
