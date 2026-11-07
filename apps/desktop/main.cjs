const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

// 禁用硬件加速，彻底解决 resize 黑色闪烁
app.disableHardwareAcceleration();

let backendProcess = null;
let mainWindow = null;

const isDev = !app.isPackaged;
const BACKEND_PORT = 3001;
const CHAT_SLUG = 'yw2h7ngjq6';

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
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 800,
    minHeight: 600,
    autoHideMenuBar: true,
    title: '张华 · AI 简历助手',
    backgroundColor: '#ffffff',
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  Menu.setApplicationMenu(null);

  try { await waitForBackend(); } catch { console.log('backend wait timeout'); }
  mainWindow.loadURL(`http://localhost:${BACKEND_PORT}/c/${CHAT_SLUG}`);

  // 右键菜单
  const contextMenu = Menu.buildFromTemplate([
    { label: '刷新', role: 'reload' },
    { label: '检查元素', click: () => mainWindow.webContents.openDevTools({ mode: 'detach' }) },
  ]);
  mainWindow.webContents.on('context-menu', () => contextMenu.popup());
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
