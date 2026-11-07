/**
 * preload：把公共 JS Bridge 挂到 window.desktopBridge，供 React 页面调用。
 *
 * - 同一份 preload 同时服务主窗口和专业版窗口，窗口身份由 main 进程通过
 *   additionalArguments（--app-window=main|pro）传入，React 侧用
 *   window.desktopBridge.runtime.windowKind 区分。
 * - 渲染进程仍然拿不到 Node / ipcRenderer 原始对象（contextIsolation: true）。
 */

const { contextBridge, ipcRenderer } = require('electron');
const { createBridge } = require('./bridge/preload-api.cjs');

const bridge = createBridge({
  ipcRenderer,
  argv: process.argv,
  platform: process.platform,
  appVersion: process.env.APP_VERSION || '',
});

contextBridge.exposeInMainWorld('desktopBridge', bridge);
