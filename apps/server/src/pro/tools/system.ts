import type { ToolDef } from './types.js';
import { truncateOutput } from './types.js';
import { resolveToolPath } from './path-safe.js';
import { saveArtifact, mimeFor } from '../artifacts.js';
import {
  systemSnapshot,
  openTarget,
  readClipboardText,
  writeClipboardText,
  captureScreen,
} from '../system.js';

/**
 * 系统控制工具（P4）。
 *
 * 分级说明：
 * - system_info / R：纯读取，不弹卡。
 * - system_open / W：会在你桌面上真的打开东西，所以要弹卡（卡片上写明打开什么）。
 * - clipboard_write / W：覆盖剪贴板，弹卡。
 * - clipboard_read / X：读剪贴板等于读你的隐私，按最高级别处理，每次都确认。
 * - screen_capture / X：截屏会把屏幕内容落成文件，每次都确认。
 */

export const systemInfo: ToolDef = {
  name: 'system_info',
  label: '系统信息',
  description:
    '读取本机系统信息：操作系统版本、CPU、内存、磁盘占用、屏幕分辨率、运行时长、主机名与内网 IP。只读，不会改动系统。',
  level: 'R',
  schema: { type: 'object', properties: {}, required: [] },
  preview: () => '读取系统信息',
  async run() {
    const snap = await systemSnapshot();
    const lines = [
      `主机：${snap.host}（${snap.platform}）`,
      `系统：${snap.osName || '未知'} ${snap.osVersion || ''}`.trim(),
      `用户：${snap.user}`,
      `CPU：${snap.cpu}（${snap.cores} 核）`,
      `内存：可用 ${snap.memFreeGB} GB / 共 ${snap.memTotalGB} GB`,
      `已运行：${snap.uptimeHours} 小时`,
      `屏幕：${snap.screen || '未知'}`,
      `磁盘：${snap.disks.length ? snap.disks.join('；') : '未知'}`,
      `内网 IP：${snap.ips.join(', ') || '未知'}`,
    ];
    return truncateOutput(lines.join('\n'));
  },
};

export const systemOpen: ToolDef = {
  name: 'system_open',
  label: '打开文件/网址/应用',
  description:
    '在用户桌面上用系统默认程序打开一个文件、文件夹、http/https 网址，或启动一个应用（只接受应用名，如 notepad、calc）。文件/文件夹必须已存在，且位于已授权的工作区或产物/上传目录内。只负责"打开"，不执行任何命令。',
  level: 'W',
  schema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['file', 'folder', 'url', 'app'], description: '打开的对象类型' },
      target: { type: 'string', description: '文件路径 / 文件夹路径 / 网址 / 应用名' },
    },
    required: ['kind', 'target'],
  },
  preview: (args) => `打开 ${String(args?.kind || '?')}：${String(args?.target || '').slice(0, 100)}`,
  async run(args, ctx) {
    const kind = String(args?.kind || '');
    if (!['file', 'folder', 'url', 'app'].includes(kind)) throw new Error('kind 只能是 file / folder / url / app');
    let target = String(args?.target || '').trim();

    if (kind === 'file' || kind === 'folder') {
      // 路径白名单：工作区 + 产物 + 上传目录，防止借"打开"去触达任意磁盘路径
      const resolved = resolveToolPath(target, ctx.roots, ctx.extraRoots, { mustExist: true });
      target = resolved.abs;
    }

    const message = await openTarget({ kind: kind as any, target });
    return `${message}\n（如果你没看到窗口弹出，可能是系统把窗口放到了别的桌面/被防火墙拦了。）`;
  },
};

export const clipboardRead: ToolDef = {
  name: 'clipboard_read',
  label: '读剪贴板',
  description:
    '读取系统剪贴板里的纯文本（最多返回 4000 字符）。这会把用户刚复制的内容读出来，属于隐私操作，所以每次都会弹权限卡。有图片/文件时不读，只报"非文本内容"。',
  level: 'X',
  schema: { type: 'object', properties: {}, required: [] },
  preview: () => '读取系统剪贴板文本',
  async run() {
    const text = await readClipboardText();
    if (!text.trim()) return '剪贴板里没有文本（可能是空的，或者只放了图片/文件）。请让用户自己复制一段文字后再试。';
    const cut = text.length > 4000;
    return `剪贴板文本（${text.length} 字符${cut ? '，已截断到 4000' : ''}）：\n\n${cut ? text.slice(0, 4000) : text}`;
  },
};

export const clipboardWrite: ToolDef = {
  name: 'clipboard_write',
  label: '写剪贴板',
  description: '把一段文本写进系统剪贴板（覆盖原有内容），方便用户直接粘贴。上限 200000 字符。',
  level: 'W',
  schema: {
    type: 'object',
    properties: { text: { type: 'string', description: '要写入剪贴板的文本' } },
    required: ['text'],
  },
  preview: (args) => {
    const text = String(args?.text || '');
    return `写入剪贴板（${text.length} 字符）：${text.slice(0, 60)}${text.length > 60 ? '…' : ''}`;
  },
  async run(args) {
    const text = String(args?.text ?? '');
    if (!text) throw new Error('text 不能为空');
    const length = await writeClipboardText(text);
    return `已写入剪贴板（${length} 字符）。用户可以直接 Ctrl+V 粘贴。`;
  },
};

export const screenCapture: ToolDef = {
  name: 'screen_capture',
  label: '截屏',
  description:
    '截取当前屏幕并存成 PNG 进产物库（可随后用 image_analyze 读它）。截屏会看到用户屏幕上的所有内容，属于隐私操作，每次都弹权限卡。',
  level: 'X',
  schema: {
    type: 'object',
    properties: { title: { type: 'string', description: '给这张截图起个名字，默认"屏幕截图"' } },
    required: [],
  },
  preview: () => '截取当前屏幕（会看到屏幕上的所有内容）',
  async run(args, ctx) {
    ctx.emit('tool_output', { chunk: '正在截屏…\n' });
    const shot = await captureScreen();
    const artifact = await saveArtifact({
      sessionId: ctx.sessionId,
      runId: ctx.runId,
      kind: 'image',
      title: String(args?.title || '屏幕截图').slice(0, 30),
      ext: '.png',
      sourcePath: shot.filePath,
      mime: mimeFor('.png'),
      meta: { source: 'screen_capture', width: shot.width, height: shot.height },
    });
    // 中间文件已经复制进产物库，删掉原件避免重复占盘
    await (await import('fs/promises')).rm(shot.filePath, { force: true }).catch(() => {});

    ctx.emit('artifact', {
      id: artifact.id,
      kind: artifact.kind,
      title: artifact.title,
      filePath: artifact.filePath,
      mime: artifact.mime,
      size: artifact.size,
      url: `/api/pro/artifacts/${artifact.id}/file`,
    });
    return truncateOutput(
      `已截屏：${shot.width}x${shot.height}，${Math.round(artifact.size / 1024)}KB，已存入产物库。\n` +
        `产物：${artifact.title}\n路径：${artifact.filePath}\n` +
        `想让助手看图，就把这个路径交给 image_analyze。`,
    );
  },
};


