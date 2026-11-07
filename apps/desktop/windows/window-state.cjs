/**
 * 窗口尺寸记忆：每种窗口一份状态文件，放在 userData 下（不随构建/代码变更丢失）。
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_FILE = 'window-state.json';

function stateFilePath(userDataDir, fileName) {
  return path.join(userDataDir, fileName || DEFAULT_STATE_FILE);
}

/** 读取失败（不存在 / 损坏 / 字段非法）时返回 null，由调用方按首次启动处理 */
function readWindowState(userDataDir, fileName) {
  try {
    const raw = fs.readFileSync(stateFilePath(userDataDir, fileName), 'utf8');
    const data = JSON.parse(raw);
    const width = Math.round(Number(data.width));
    const height = Math.round(Number(data.height));
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    return { width, height, maximized: data.maximized === true };
  } catch {
    return null;
  }
}

/** 把尺寸夹到当前屏幕可用区域内，避免外接屏拔掉后窗口跑到屏幕外 */
function clampToScreen(state, screen, minWidth, minHeight) {
  const area = screen.getPrimaryDisplay().workAreaSize;
  return {
    width: Math.min(Math.max(state.width, minWidth), Math.max(area.width, minWidth)),
    height: Math.min(Math.max(state.height, minHeight), Math.max(area.height, minHeight)),
    maximized: state.maximized === true,
  };
}

function writeWindowState(userDataDir, fileName, window) {
  if (!window || window.isDestroyed()) return;
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    const bounds = typeof window.getNormalBounds === 'function'
      ? window.getNormalBounds()
      : window.getBounds();
    fs.writeFileSync(
      stateFilePath(userDataDir, fileName),
      JSON.stringify({
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        maximized: window.isMaximized(),
      }),
      'utf8',
    );
  } catch (err) {
    console.error(`[window-state] save failed (${fileName}):`, err.message);
  }
}

module.exports = {
  DEFAULT_STATE_FILE,
  readWindowState,
  clampToScreen,
  writeWindowState,
};
