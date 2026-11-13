/**
 * P4 系统服务自检：系统信息 / 剪贴板往返 / 截屏 / 打开目标的参数校验。
 * 用法：npx tsx scripts/pro-system-check.mjs
 * 注意：会临时改写剪贴板，结束后恢复原内容；会真截一张屏（存到临时目录后删掉）。
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { systemSnapshot, openTarget, readClipboardText, writeClipboardText, captureScreen } from '../src/pro/system.ts';

const results = [];
const ok = (name, extra = '') => {
  results.push({ name, extra });
  console.log(`PASS ${name}${extra ? ` — ${extra}` : ''}`);
};
const fail = (name, error) => {
  results.push({ name, error });
  console.log(`FAIL ${name} — ${error}`);
};

const skip = (name, reason) => {
  results.push({ name, skipped: true });
  console.log(`SKIP ${name} — ${reason}`);
};

// 1) 系统信息
try {
  const snap = await systemSnapshot();
  if (!snap.host || !snap.cpu || snap.cores < 1) throw new Error(`字段不完整：${JSON.stringify(snap)}`);
  ok('系统信息可读', `${snap.osName || '未知 OS'} / ${snap.cores} 核 / 内存 ${snap.memTotalGB}GB / 屏幕 ${snap.screen || '未知'}`);
} catch (err) {
  fail('系统信息可读', err?.message || err);
}

// 2) 剪贴板往返（先备份原内容，测完恢复）
if (process.platform !== 'win32' && process.platform !== 'darwin') {
  skip('剪贴板往返', `当前平台（${process.platform}）不支持剪贴板，跳过`);
} else
try {
  const original = await readClipboardText();
  const marker = `pro-clip-${Date.now()}-中文-🙂`;
  await writeClipboardText(marker);
  const back = await readClipboardText();
  if (back !== marker) throw new Error(`读回不一致：${JSON.stringify(back).slice(0, 40)}`);
  ok('剪贴板写入后可原样读回', `${marker.length} 字符`);
  await writeClipboardText(original);
  ok('剪贴板已恢复原内容', `${original.length} 字符`);
} catch (err) {
  fail('剪贴板往返', err?.message || err);
}

// 3) 截屏
let shotPath = '';
if (process.platform !== 'win32' && process.platform !== 'darwin') {
  skip('截屏成功', `当前平台（${process.platform}）不支持截屏，跳过`);
} else
try {
  const shot = await captureScreen();
  shotPath = shot.filePath;
  const stat = await fs.stat(shot.filePath);
  if (!stat.size) throw new Error('截图文件是 0 字节');
  ok('截屏成功', `${shot.width}x${shot.height} / ${Math.round(stat.size / 1024)}KB`);
} catch (err) {
  fail('截屏成功', err?.message || err);
}

// 4) 打开目标的入参校验（真的打开会弹窗，这里只验"该拒的拒"）
try {
  await openTarget({ kind: 'file', target: path.join(os.tmpdir(), 'pro-no-such-file-xyz.txt') });
  fail('不存在的路径被拒绝', '居然没报错');
} catch (err) {
  ok('不存在的路径被拒绝', err?.message || String(err));
}
try {
  await openTarget({ kind: 'url', target: 'javascript:alert(1)' });
  fail('非 http/https 网址被拒绝', '居然没报错');
} catch (err) {
  ok('非 http/https 网址被拒绝', err?.message || String(err));
}
try {
  await openTarget({ kind: 'app', target: 'powershell' });
  fail('命令解释器被拒绝', '居然没报错');
} catch (err) {
  ok('命令解释器被拒绝', err?.message || String(err));
}

if (shotPath) await fs.rm(shotPath, { force: true }).catch(() => {});

const failed = results.filter((r) => r.error);
console.log(`\n=== 结果：${failed.length ? `${failed.length} 项失败` : '全部通过'} ===`);
if (failed.length) process.exit(1);
