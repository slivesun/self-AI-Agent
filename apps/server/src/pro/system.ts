import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'node:child_process';
import { PRO_ARTIFACTS_DIR } from './paths.js';

/**
 * 系统服务（P4）：系统信息、打开文件/网址/应用、剪贴板、截屏。
 *
 * 这里是**服务端**做的事，跑在后端 node 进程里（不是 Electron 主进程），
 * 所以统一走系统命令：Windows 用 PowerShell，macOS 用 osascript/open。
 * 所有能力都只由工具层调用，而工具层的级别决定了是否要弹权限卡。
 */

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

/** 跑一段 PowerShell 脚本（UTF-8 进出，超时可杀进程树） */
function runPowerShell(script: string, timeoutMs = 20_000): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; ${script}`,
      ],
      { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
    );
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
    }, timeoutMs);
    child.stdout?.on('data', (b: Buffer) => {
      if (stdout.length < 400_000) stdout += b.toString('utf8');
    });
    child.stderr?.on('data', (b: Buffer) => {
      if (stderr.length < 200_000) stderr += b.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

export interface SystemSnapshot {
  host: string;
  platform: string;
  osName: string;
  osVersion: string;
  cpu: string;
  cores: number;
  memTotalGB: number;
  memFreeGB: number;
  uptimeHours: number;
  user: string;
  disks: string[];
  screen: string;
  ips: string[];
}

/** 系统信息：优先用真实的系统接口，拿不到的字段标 null 而不是编一个 */
export async function systemSnapshot(): Promise<SystemSnapshot> {
  const base: SystemSnapshot = {
    host: os.hostname(),
    platform: `${process.platform} ${os.arch()}`,
    osName: '',
    osVersion: '',
    cpu: os.cpus()[0]?.model || '',
    cores: os.cpus().length,
    memTotalGB: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
    memFreeGB: Number((os.freemem() / 1024 ** 3).toFixed(1)),
    uptimeHours: Number((os.uptime() / 3600).toFixed(1)),
    user: os.userInfo().username,
    disks: [],
    screen: '',
    ips: Object.values(os.networkInterfaces())
      .flat()
      .filter((n): n is os.NetworkInterfaceInfo => Boolean(n && n.family === 'IPv4' && !n.internal))
      .map((n) => n.address),
  };

  if (IS_WIN) {
    const script = `
$ErrorActionPreference='Stop'
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$disks = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
  "{0} {1:N1}/{2:N1} GB" -f $_.DeviceID, (([double]$_.Size - [double]$_.FreeSpace) / 1GB), ([double]$_.Size / 1GB)
}
$screen = Add-Type -AssemblyName System.Windows.Forms -PassThru | Out-Null
$w = [System.Windows.Forms.SystemInformation]::VirtualScreen
$obj = @{
  osName = $os.Caption
  osVersion = $os.Version
  user = $cs.UserName
  disks = @($disks)
  screen = "$($w.Width)x$($w.Height)"
}
$obj | ConvertTo-Json -Compress -Depth 4
`;
    try {
      const { stdout } = await runPowerShell(script, 25_000);
      const parsed = JSON.parse(stdout.trim() || '{}');
      base.osName = String(parsed.osName || '');
      base.osVersion = String(parsed.osVersion || '');
      base.user = String(parsed.user || base.user);
      base.disks = Array.isArray(parsed.disks) ? parsed.disks : parsed.disks ? [parsed.disks] : [];
      base.screen = String(parsed.screen || '');
    } catch {
      // 拿不到就空着，交给上层如实说明
    }
  } else if (IS_MAC) {
    base.osName = 'macOS';
    try {
      const { stdout } = await runPowerShellSystemProfiler();
      base.osVersion = stdout.trim();
    } catch {}
  }

  return base;
}

function runPowerShellSystemProfiler(): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('sw_vers', ['-productVersion']);
    let stdout = '';
    child.stdout.on('data', (b: Buffer) => (stdout += b.toString('utf8')));
    child.on('error', reject);
    child.on('close', () => resolve({ stdout }));
  });
}

/** 打开目标时明确禁止的"命令解释器"，避免被当成任意命令执行通道 */
const BLOCKED_APPS = /^(cmd|cmd\.exe|powershell|powershell\.exe|pwsh|pwsh\.exe|wscript|cscript|mshta|regedit|regedt32|rundll32|control|mmc|bash|sh|zsh)$/i;

export interface OpenTargetInput {
  /** file | folder | url | app */
  kind: 'file' | 'folder' | 'url' | 'app';
  target: string;
}

/** 打开文件/文件夹/网址/应用：只负责"打开"，不注入任何命令 */
export async function openTarget(input: OpenTargetInput): Promise<string> {
  const target = String(input.target || '').trim();
  if (!target) throw new Error('target 不能为空');
  if (target.length > 260) throw new Error('target 过长');

  if (input.kind === 'url') {
    if (!/^https?:\/\/[^\s]+$/i.test(target)) throw new Error('只允许打开 http/https 网址');
    await spawnDetached(IS_WIN ? 'powershell.exe' : IS_MAC ? 'open' : 'xdg-open', IS_WIN ? ['-NoLogo', '-NoProfile', '-Command', `Start-Process '${target.replace(/'/g, "''")}'`] : [target]);
    return `已在默认浏览器打开：${target}`;
  }

  if (input.kind === 'app') {
    if (/[\\/]/.test(target)) throw new Error('打开应用只接受应用名（例如 notepad、calc），不接受路径');
    if (BLOCKED_APPS.test(target)) throw new Error(`出于安全考虑，不允许打开 ${target}`);
    await spawnDetached(target, []);
    return `已尝试启动应用：${target}`;
  }

  // file / folder：必须是真实存在的绝对路径（路径白名单由工具层校验）
  const stat = await fs.stat(target).catch(() => null);
  if (!stat) throw new Error(`路径不存在：${target}`);
  if (input.kind === 'folder' && !stat.isDirectory()) throw new Error('这不是一个文件夹');
  if (input.kind === 'file' && stat.isDirectory()) throw new Error('这是一个文件夹，请用 kind=folder 打开');

  if (IS_WIN) {
    await spawnDetached('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', `Start-Process -LiteralPath '${target.replace(/'/g, "''")}'`]);
  } else if (IS_MAC) {
    await spawnDetached('open', [target]);
  } else {
    await spawnDetached('xdg-open', [target]);
  }
  return `已用系统默认程序打开：${target}`;
}

function spawnDetached(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false });
      child.on('error', reject);
      child.unref();
      // 给一点时间让系统接手，避免"刚开就报失败"
      setTimeout(resolve, 300);
    } catch (err) {
      reject(err);
    }
  });
}

/** 剪贴板：只处理纯文本，读写都走临时文件，中文/emoji 不乱码 */
export async function readClipboardText(): Promise<string> {
  const tmp = path.join(os.tmpdir(), `pro-clip-${crypto.randomUUID()}.txt`);
  try {
    if (IS_WIN) {
      const { stderr, code } = await runPowerShell(
        `$t = Get-Clipboard -Raw -Format Text; if ($null -eq $t) { $t = '' }; [IO.File]::WriteAllText('${tmp.replace(/'/g, "''")}', $t, (New-Object Text.UTF8Encoding($false)))`,
        15_000,
      );
      if (code !== 0) throw new Error(stderr.trim() || '读取剪贴板失败');
    } else if (IS_MAC) {
      const child = spawn('pbpaste');
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        child.stdout.on('data', (b: Buffer) => chunks.push(b));
        child.on('error', reject);
        child.on('close', () => resolve());
      });
      return Buffer.concat(chunks).toString('utf8');
    } else {
      throw new Error('当前平台暂不支持读取剪贴板');
    }
    return await fs.readFile(tmp, 'utf8');
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

export async function writeClipboardText(text: string): Promise<number> {
  const value = String(text ?? '');
  if (value.length > 200_000) throw new Error('文本过长（上限 200000 字符）');
  const tmp = path.join(os.tmpdir(), `pro-clip-${crypto.randomUUID()}.txt`);
  await fs.writeFile(tmp, value, 'utf8');
  try {
    if (IS_WIN) {
      const { stderr, code } = await runPowerShell(
        `Set-Clipboard -Value ([IO.File]::ReadAllText('${tmp.replace(/'/g, "''")}', [Text.Encoding]::UTF8))`,
        15_000,
      );
      if (code !== 0) throw new Error(stderr.trim() || '写入剪贴板失败');
    } else if (IS_MAC) {
      await new Promise<void>((resolve, reject) => {
        const child = spawn('pbcopy');
        child.on('error', reject);
        child.on('close', () => resolve());
        child.stdin.write(value, 'utf8');
        child.stdin.end();
      });
    } else {
      throw new Error('当前平台暂不支持写入剪贴板');
    }
    return value.length;
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

export interface ScreenCaptureResult {
  filePath: string;
  width: number;
  height: number;
  bytes: number;
}

/** 截屏：截主屏（Windows 用虚拟屏矩形，等于把所有显示器拼起来），存成 PNG 文件 */
export async function captureScreen(): Promise<ScreenCaptureResult> {
  const dir = path.join(PRO_ARTIFACTS_DIR, 'image');
  await fs.mkdir(dir, { recursive: true });
  const out = path.join(dir, `screen-${Date.now()}.png`);
  const escaped = out.replace(/'/g, "''");

  if (IS_WIN) {
    const script = `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$r = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap($r.Width, $r.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
$bmp.Save('${escaped}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "$($r.Width)x$($r.Height)"
`;
    const { stdout, stderr, code } = await runPowerShell(script, 30_000);
    if (code !== 0) throw new Error(stderr.trim() || '截屏失败');
    const size = stdout.trim().match(/(\d+)x(\d+)/);
    const stat = await fs.stat(out).catch(() => null);
    if (!stat || !stat.size) throw new Error('截屏没有生成文件（可能是桌面会话不允许抓屏）');
    return {
      filePath: out,
      width: size ? Number(size[1]) : 0,
      height: size ? Number(size[2]) : 0,
      bytes: stat.size,
    };
  }

  if (IS_MAC) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('screencapture', ['-x', out]);
      child.on('error', reject);
      child.on('close', () => resolve());
    });
    const stat = await fs.stat(out).catch(() => null);
    if (!stat || !stat.size) throw new Error('截屏没有生成文件（多半是没给「屏幕录制」权限）');
    return { filePath: out, width: 0, height: 0, bytes: stat.size };
  }

  throw new Error('当前平台暂不支持截屏');
}
