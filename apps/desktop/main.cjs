const { app, BrowserWindow, Menu, ipcMain, shell, Tray, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// Electron 45+ 已内置窗口 resize 黑色残影 bug 的官方修复（见 https://electron.js.cn/blog/tech-talk-window-resize-behavior）
// 无需再禁用硬件加速或设置 use-angle=swiftshader 等 workaround

let backendProcess = null;
let mainWindow = null;
let tray = null;

const isDev = !app.isPackaged;
const BACKEND_PORT = 3001;
const CHAT_SLUG = 'yw2h7ngjq6';

// 与 electron-builder 的 appId 保持一致，Windows 任务栏按此归组并使用窗口图标
const APP_ID = 'com.resume.agent';
app.setAppUserModelId(APP_ID);

// 品牌图标：由 apps/web/public/favicon.svg（顶部栏 BrandMark 同源）栅格化的多尺寸 ICO
const ICON_ICO = path.join(__dirname, 'assets', 'icon.ico');
const ICON_TRAY = path.join(__dirname, 'assets', 'tray.png');

// 窗口默认尺寸：首次打开就是最小尺寸
const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;
// 上次关闭时的窗口尺寸记录在用户数据目录（不随代码/构建变更丢失）
const WINDOW_STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json');
let saveStateTimer = null;

function readWindowState() {
  try {
    const raw = fs.readFileSync(WINDOW_STATE_FILE(), 'utf8');
    const data = JSON.parse(raw);
    const width = Math.round(Number(data.width));
    const height = Math.round(Number(data.height));
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    return { width, height, maximized: data.maximized === true };
  } catch {
    return null; // 文件不存在或已损坏：按首次启动处理
  }
}

function clampToScreen(state) {
  const area = screen.getPrimaryDisplay().workAreaSize;
  return {
    width: Math.min(Math.max(state.width, MIN_WIDTH), Math.max(area.width, MIN_WIDTH)),
    height: Math.min(Math.max(state.height, MIN_HEIGHT), Math.max(area.height, MIN_HEIGHT)),
    maximized: state.maximized,
  };
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // getNormalBounds 在最大化/最小化时仍返回"还原后"的尺寸，避免把全屏尺寸写进记录
  const bounds = typeof mainWindow.getNormalBounds === 'function'
    ? mainWindow.getNormalBounds()
    : mainWindow.getBounds();
  const state = {
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
    maximized: mainWindow.isMaximized(),
  };
  try {
    fs.mkdirSync(path.dirname(WINDOW_STATE_FILE()), { recursive: true });
    fs.writeFileSync(WINDOW_STATE_FILE(), JSON.stringify(state), 'utf8');
  } catch (err) {
    console.error('[window-state] save failed:', err.message);
  }
}

function scheduleSaveWindowState() {
  if (saveStateTimer) clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(saveWindowState, 400);
}

function startBackend() {
  if (isDev) {
    // 开发模式：用 tsx 启动后端
    const serverDir = path.join(__dirname, '../../server');
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
      fetch(`http://localhost:${BACKEND_PORT}/api/c/${CHAT_SLUG}`)
        .then(() => resolve())
        .catch(() => {
          if (n <= 0) return reject(new Error('Backend failed to start'));
          setTimeout(() => check(n - 1), 500);
        });
    };
    check(retries);
  });
}

async function createWindow() {
  const iconPath = ICON_ICO;
  // 恢复上次关闭时的窗口尺寸；没有记录（首次运行）时用最小尺寸
  const saved = readWindowState();
  const initial = clampToScreen(saved ?? { width: MIN_WIDTH, height: MIN_HEIGHT, maximized: false });
  mainWindow = new BrowserWindow({
    width: initial.width,
    height: initial.height,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    center: true,
    autoHideMenuBar: true,
    title: '个人AI助手',
    icon: iconPath,
    backgroundColor: '#ffffff',
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      // 确保 webContents 背景与窗口一致
      backgroundColor: '#ffffff',
    },
  });

  // 运行时再次设置窗口背景色，确保 resize 时边缘不露出黑色
  mainWindow.setBackgroundColor('#ffffff');

  // 上次关闭时处于最大化，则还原成最大化
  if (initial.maximized) mainWindow.maximize();

  // 记录窗口尺寸：拖拽/最大化变化时节流写盘，关闭前立刻写一次
  mainWindow.on('resize', scheduleSaveWindowState);
  mainWindow.on('maximize', scheduleSaveWindowState);
  mainWindow.on('unmaximize', scheduleSaveWindowState);
  mainWindow.on('close', () => {
    if (saveStateTimer) { clearTimeout(saveStateTimer); saveStateTimer = null; }
    saveWindowState();
  });

  // 自绘标题栏的最小化 / 最大化 / 关闭
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:toggle-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window:close', () => mainWindow?.close());
  ipcMain.handle('window:is-maximized', () => !!mainWindow?.isMaximized());
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximized', false));

  Menu.setApplicationMenu(null);

  try { await waitForBackend(); } catch { console.log('backend wait timeout'); }
  mainWindow.loadURL(`http://localhost:${BACKEND_PORT}/c/${CHAT_SLUG}`);

  // 右键菜单
  const contextMenu = Menu.buildFromTemplate([
    { label: '刷新', role: 'reload' },
    { label: '检查元素', click: () => mainWindow.webContents.openDevTools({ mode: 'detach' }) },
  ]);
  mainWindow.webContents.on('context-menu', () => contextMenu.popup());

  // 系统托盘（与任务栏同一套品牌图标）
  const trayIcon = nativeImage.createFromPath(ICON_TRAY);
  tray = new Tray(trayIcon);
  tray.setToolTip('个人AI助手');

  const trayMenu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: '隐藏窗口', click: () => mainWindow?.hide() },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuiting = true; mainWindow?.close(); } },
  ]);
  tray.setContextMenu(trayMenu);

  // 点击托盘图标显示/隐藏窗口
  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  startBackend();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (backendProcess) { backendProcess.kill(); backendProcess = null; }
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (backendProcess) { backendProcess.kill(); backendProcess = null; }
});
