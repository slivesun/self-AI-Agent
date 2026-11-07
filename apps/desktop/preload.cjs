const { contextBridge, ipcRenderer } = require('electron');

// 只暴露窗口控制相关的最小能力，渲染进程不接触 Node / ipcRenderer 原始对象
contextBridge.exposeInMainWorld('desktop', {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onMaximizeChange: (cb) => {
    const handler = (_event, value) => cb(!!value);
    ipcRenderer.on('window:maximized', handler);
    return () => ipcRenderer.removeListener('window:maximized', handler);
  },
});
