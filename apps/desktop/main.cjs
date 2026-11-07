const { app, BrowserWindow, Menu, Tray, nativeImage, screen, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

const { registerIpcHandlers } = require('./ipc/index.cjs');
const { createMainWindow, showMainWindow, getMainWindow } = require('./windows/main-window.cjs');
const { openProWindow } = require('./windows/pro-window.cjs');

// Electron 45+ 已内置窗口 resize 黑色残影 bug 的官方修复（见 https://electron.js.cn/blog/tech-talk-window-resize-behavior）
// 无需再禁用硬件加速或设置 use-angle=swiftshader 等 workaround

let backendProcess = null;
let tray = null;

const isDev = !app.isPackaged;
const BACKEND_PORT = 3001;
const CHAT_SLUG = 'yw2h7ngjq6';
const CHAT_PATH = `/c/${CHAT_SLUG}`;
const PRO_PATH = '/pro';
const BASE_URL = `http://localhost:${BACKEND_PORT}`;
const MAIN_URL = `${BASE_URL}${CHAT_PATH}`;
const PRO_URL = `${BASE_URL}${PRO_PATH}`;

// 与 electron-builder 的 appId 保持一致，Windows 任务栏按此归组并使用窗口图标
const APP_ID = 'com.resume.agent';
app.setAppUserModelId(APP_ID);

// 品牌图标：由 apps/web/public/favicon.svg（顶部栏 BrandMark 同源）栅格化的多尺寸 ICO
const ICON_ICO = path.join(__dirname, 'assets', 'icon.ico');
const ICON_TRAY = path.join(__dirname, 'assets', 'tray.png');

const userDataDir = app.getPath('userData');

/** 主窗口创建参数 */
function mainWindowDeps(extra) {
  return {
    BrowserWindow,
    screen,
    Menu,
    icon: ICON_ICO,
    userDataDir,
    url: MAIN_URL,
    ...extra,
  };
}

/** 专业版窗口创建参数 */
function proWindowDeps(extra) {
  return {
    BrowserWindow,
    screen,
    Menu,
    icon: ICON_ICO,
    userDataDir,
    ...extra,
  };
}

function startBackend() {
  if (isDev) {
    // 开发模式：用 tsx 启动后端
    backendProcess = spawn('npx', ['tsx', '--env-file', 'apps/server/.env', 'apps/server/src/index.ts'], {
      cwd: path.join(__dirname, '../..'),
      shell: true,
      stdio: 'pipe',
    });
  } else {
    // 生产模式：启动打包后的后端
    backendProcess = spawn(process.execPath, [path.join(process.resourcesPath, 'server.cjs')], {
      stdio: 'pipe',
    });
  }

  backendProcess.stdout?.on('data', (data) => {
    console.log(`[backend] ${data}`);
  });
  backendProcess.stderr?.on('data', (data) => {
    console.error(`[backend] ${data}`);
  });
}

function waitForBackend(retries = 30) {
  return new Promise((resolve, reject) => {
    const check = (n) => {
      fetch(MAIN_URL)
        .then(() => resolve())
        .catch(() => {
          if (n <= 0) return reject(new Error('Backend failed to start'));
          setTimeout(() => check(n - 1), 500);
        });
    };
    check(retries);
  });
}

/**
 * 托盘：主窗口可能已被关闭（专业版仍开着），点击时按需重建，而不是对空引用无效操作。
 * 专业版入口只放在页面里，避免绕过"需登录"的入口校验。
 */
function toggleMainWindow() {
  const win = getMainWindow();
  if (win && win.isVisible()) {
    win.hide();
    return;
  }
  showMainWindow(mainWindowDeps());
}

function createTray() {
  if (tray) return;
  tray = new Tray(nativeImage.createFromPath(ICON_TRAY));
  tray.setToolTip('个人AI助手');

  const trayMenu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => showMainWindow(mainWindowDeps()) },
    { label: '隐藏窗口', click: () => getMainWindow()?.hide() },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuiting = true; app.quit(); } },
  ]);
  tray.setContextMenu(trayMenu);

  tray.on('click', toggleMainWindow);
}

async function bootstrap() {
  Menu.setApplicationMenu(null);

  registerIpcHandlers({
    ipcMain,
    BrowserWindow,
    getProUrl: () => PRO_URL,
    openPro: ({ theme, url }) => openProWindow(proWindowDeps({ url, theme })),
  });

  // 首次启动要等后端就绪再加载，避免页面先渲染成错误页
  const mainWindow = createMainWindow(mainWindowDeps({ deferLoad: true }));

  try {
    await waitForBackend();
  } catch (err) {
    console.log('backend wait timeout', err && err.message);
  }

  try {
    await mainWindow.loadURL(MAIN_URL);
  } catch {
    // 窗口在后端就绪前被用户关掉：无需再加载
  }
  createTray();
}

app.whenReady().then(() => {
  startBackend();
  bootstrap();
  // macOS：点击 Dock 图标时如果没有任何窗口，重建主窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) showMainWindow(mainWindowDeps());
  });
});

// 只有所有窗口都关闭（主窗口 + 专业版）才退出进程，专业版不会因主窗口关闭而被带走
app.on('window-all-closed', () => {
  if (backendProcess) { backendProcess.kill(); backendProcess = null; }
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (backendProcess) { backendProcess.kill(); backendProcess = null; }
});
