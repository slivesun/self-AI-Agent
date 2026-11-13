const { app, BrowserWindow, Menu, Tray, nativeImage, screen, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
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
// 仅在拿不到后端默认链接时兜底使用（正常情况由 /api/default-link 决定）
const CHAT_SLUG = 'yw2h7ngjq6';
const CHAT_PATH = `/c/${CHAT_SLUG}`;
// 专业版是独立的多入口页面（apps/web/pro.html），不是主 SPA 里的路由
const PRO_PATH = '/pro.html';
const BASE_URL = `http://localhost:${BACKEND_PORT}`;
let chatUrl = `${BASE_URL}${CHAT_PATH}`;
const PRO_URL = `${BASE_URL}${PRO_PATH}`;

// 打包后后端会作为独立目录放进 resources/backend（见 apps/desktop/scripts/package.mjs）
const BACKEND_DIR = isDev
  ? path.join(__dirname, '..', 'server')
  : path.join(process.resourcesPath, 'backend');

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
    url: chatUrl,
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

/** 读取后端目录下的 .env（安装包里没有 node 的 --env-file，这里手动注入环境变量） */
function readEnvFile(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const env = {};
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key) env[key] = value;
    }
    return env;
  } catch {
    return {};
  }
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
    // 生产模式：用 Electron 自带的 Node（ELECTRON_RUN_AS_NODE）跑后端 JS，
    // 用户机器上不需要另外装 Node。数据库落用户目录，前端产物指向包内 web 目录。
    const entry = path.join(BACKEND_DIR, 'dist', 'index.js');
    // 环境变量来源：用户数据目录的 config/.env（用户自己填）优先，其次包内 .env（若存在）
    const userEnv = readEnvFile(path.join(app.getPath('userData'), 'config', '.env'));
    const bundledEnv = readEnvFile(path.join(BACKEND_DIR, '.env'));
    const dotenv = { ...bundledEnv, ...userEnv };

    backendProcess = spawn(process.execPath, [entry], {
      cwd: BACKEND_DIR,
      windowsHide: true,
      stdio: 'pipe',
      env: {
        ...process.env,
        ...dotenv,
        ELECTRON_RUN_AS_NODE: '1',
        PORT: String(BACKEND_PORT),
        RESUME_DATA_DIR: path.join(app.getPath('userData'), 'data'),
        WEB_DIST_DIR: path.join(BACKEND_DIR, 'web'),
        NODE_OPTIONS: '',
      },
    });

    backendProcess.on('error', (err) => {
      console.error('[backend] 启动失败:', err && err.message ? err.message : err);
    });
    backendProcess.on('exit', (code) => {
      console.error(`[backend] 进程退出，code=${code}`);
      backendProcess = null;
    });
  }

  backendProcess.stdout?.on('data', (data) => {
    console.log(`[backend] ${data}`);
  });
  backendProcess.stderr?.on('data', (data) => {
    console.error(`[backend] ${data}`);
  });
}

function waitForBackend(retries = 60) {
  return new Promise((resolve, reject) => {
    const check = (n) => {
      fetch(`${BASE_URL}/api/default-link`)
        .then(() => resolve())
        .catch(() => {
          if (n <= 0) return reject(new Error('Backend failed to start'));
          setTimeout(() => check(n - 1), 500);
        });
    };
    check(retries);
  });
}

/** 后端就绪后向它要默认对话链接的 slug，避免客户端写死（换库/首次启动 slug 会变） */
async function resolveChatUrl() {
  try {
    const res = await fetch(`${BASE_URL}/api/default-link`);
    const json = await res.json();
    const slug = json && json.ok && json.data && json.data.slug;
    if (slug) return `${BASE_URL}/c/${slug}`;
  } catch {
    // 忽略：回退到内置 slug
  }
  return `${BASE_URL}${CHAT_PATH}`;
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
    dialog,
    getProUrl: () => PRO_URL,
    openPro: ({ theme, url }) => openProWindow(proWindowDeps({ url, theme })),
  });

  // 首次启动要等后端就绪再加载，避免页面先渲染成错误页
  const mainWindow = createMainWindow(mainWindowDeps({ deferLoad: true }));

  try {
    await waitForBackend();
    chatUrl = await resolveChatUrl();
  } catch (err) {
    console.log('backend wait timeout', err && err.message);
  }

  try {
    await mainWindow.loadURL(chatUrl);
  } catch {
    // 窗口在后端就绪前被用户关掉：无需再加载
  }
  createTray();
}

// 单实例：重复启动时把已有窗口拉到前台，避免两个进程抢同一个后端端口
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow(mainWindowDeps());
  });

  app.whenReady().then(() => {
    startBackend();
    bootstrap();
    // macOS：点击 Dock 图标时如果没有任何窗口，重建主窗口
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) showMainWindow(mainWindowDeps());
    });
  });

  // 关闭所有窗口即退出应用；后端进程统一在 before-quit 里清理（避免重复 kill）
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    app.isQuiting = true;
    if (backendProcess) {
      try { backendProcess.kill(); } catch {}
      backendProcess = null;
    }
  });
}
