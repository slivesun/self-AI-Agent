/**
 * 主进程 IPC 注册：所有窗口控制都以"发起请求的那个窗口"为目标。
 * 这是专业版窗口能独立控制自己的前提——旧实现把通道写死到 mainWindow，
 * 会导致专业版标题栏的按钮去操作主窗口。
 */

const { CHANNELS } = require('../bridge/channels.cjs');

const ok = (data) => ({ ok: true, data });
const fail = (error) => ({ ok: false, error });

function registerIpcHandlers({ ipcMain, BrowserWindow, openPro, getProUrl, dialog }) {
  /** 找到发起本次调用的窗口（已销毁/不存在时返回 null） */
  const senderWindow = (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win && !win.isDestroyed() ? win : null;
  };

  ipcMain.on(CHANNELS.WINDOW_MINIMIZE, (event) => {
    senderWindow(event)?.minimize();
  });

  ipcMain.on(CHANNELS.WINDOW_TOGGLE_MAXIMIZE, (event) => {
    const win = senderWindow(event);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  ipcMain.on(CHANNELS.WINDOW_CLOSE, (event) => {
    senderWindow(event)?.close();
  });

  ipcMain.handle(CHANNELS.WINDOW_IS_MAXIMIZED, (event) => {
    const win = senderWindow(event);
    return ok(!!win && win.isMaximized());
  });

  ipcMain.handle(CHANNELS.PRO_OPEN, (event, payload) => {
    const win = senderWindow(event);
    if (!win) return fail('窗口不可用');
    const theme = payload && payload.theme === 'dark' ? 'dark' : 'light';
    try {
      const result = openPro({ theme, url: getProUrl() });
      return ok(result);
    } catch (err) {
      return fail(err && err.message ? err.message : '未知错误');
    }
  });

  // 系统目录选择：只在用户点按钮时弹，返回 { path: string | null }（取消时 path 为 null）
  ipcMain.handle(CHANNELS.DIALOG_CHOOSE_DIRECTORY, async (event, payload) => {
    if (!dialog) return fail('当前环境不支持系统目录选择');
    const win = senderWindow(event);
    try {
      const result = await dialog.showOpenDialog(win || undefined, {
        title: (payload && payload.title) || '选择工作区目录',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: (payload && payload.defaultPath) || undefined,
      });
      if (result.canceled || !result.filePaths || !result.filePaths.length) return ok({ path: null });
      return ok({ path: result.filePaths[0] });
    } catch (err) {
      return fail(err && err.message ? err.message : '选择目录失败');
    }
  });
}

module.exports = { registerIpcHandlers };
