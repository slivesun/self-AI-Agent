import { spawn, spawnSync } from 'node:child_process';
import path from 'path';
import type { ToolDef } from './types.js';
import { truncateOutput } from './types.js';
import { resolveToolPath } from './path-safe.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 12_000;
const HEAD_CHARS = 3_000;
const TAIL_CHARS = 7_000;

/** 高危命令特征：命中时权限卡上会明确标红提示（仍然由用户决定） */
const RISKY_PATTERNS: { re: RegExp; note: string }[] = [
  { re: /\brm\s+-rf?\b/i, note: '递归删除' },
  { re: /Remove-Item[^\n]*-Recurse/i, note: '递归删除' },
  { re: /\b(del|erase)\s+\/[fsq]/i, note: '强制/静默删除' },
  { re: /\b(rd|rmdir)\s+\/s/i, note: '递归删目录' },
  { re: /\bformat\s+\w:/i, note: '格式化磁盘' },
  { re: /\bdiskpart\b/i, note: '磁盘分区操作' },
  { re: /git\s+reset\s+--hard/i, note: '丢弃未提交改动' },
  { re: /git\s+clean\s+-[fd]+/i, note: '删除未跟踪文件' },
  { re: /git\s+push[^\n]*(--force|-f\b)/i, note: '强推远端分支' },
  { re: /\b(taskkill|Stop-Process)\b/i, note: '结束进程' },
  { re: /\b(shutdown|Restart-Computer|Stop-Computer)\b/i, note: '关机/重启' },
  { re: /\b(reg\s+delete|Remove-ItemProperty)\b/i, note: '删除注册表' },
  { re: /\b(mkfs|dd\s+if=)/i, note: '破坏性磁盘写' },
];

function riskNotes(command: string): string[] {
  return RISKY_PATTERNS.filter((p) => p.re.test(command)).map((p) => p.note);
}

function clip(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, HEAD_CHARS)}\n…（中间省略 ${text.length - HEAD_CHARS - TAIL_CHARS} 字符）…\n${text.slice(-TAIL_CHARS)}`;
}

export const shellRun: ToolDef = {
  name: 'shell_run',
  label: '执行命令',
  description:
    '在工作区内执行一条 PowerShell 命令（Windows）或 bash 命令（macOS/Linux），返回退出码与输出。用于跑构建、测试、lint、git 状态等。cwd 必须在已授权的工作区里；命令默认 60 秒超时（最长 120 秒）。不要用它做与任务无关的系统级操作。',
  level: 'X',
  schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: '要执行的命令行，例如 npm test、git status --short、dir src' },
      cwd: { type: 'string', description: '工作目录（相对工作区或绝对路径），默认第一个工作区根目录' },
      timeoutMs: { type: 'number', description: '超时毫秒数，默认 60000，最大 120000' },
    },
    required: ['command'],
  },
  preview: (args) => {
    const command = String(args?.command || '').trim();
    const risks = riskNotes(command);
    const prefix = risks.length ? `⚠ 高危（${risks.join('、')}）：` : '';
    return `${prefix}执行命令 ${command}${args?.cwd ? `（目录 ${args.cwd}）` : ''}`;
  },
  async run(args, ctx) {
    const command = String(args?.command || '').trim();
    if (!command) throw new Error('command 不能为空');
    if (command.length > 4000) throw new Error('命令过长（超过 4000 字符）');

    const base = resolveToolPath(args?.cwd || '.', ctx.roots, ctx.extraRoots, { mustExist: true });
    const cwd = base.abs;
    // 上传目录是只读参考资料，命令只允许在工作区里跑
    if (!ctx.roots.some((root) => !path.relative(root, cwd).startsWith('..'))) {
      throw new Error('命令只能在已授权的工作区内执行');
    }

    const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(2_000, Number(args?.timeoutMs) || DEFAULT_TIMEOUT_MS));
    const isWin = process.platform === 'win32';
    const startedAt = Date.now();

    ctx.emit('tool_output', { chunk: `$ ${command}\n（目录：${cwd}）\n\n` });

    return await new Promise<string>((resolve) => {
      const child = isWin
        ? spawn(
            'powershell.exe',
            [
              '-NoLogo',
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              `$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; $env:NO_COLOR='1'; ${command}`,
            ],
            { cwd, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
          )
        : spawn('/bin/bash', ['-lc', command], { cwd, env: { ...process.env } });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;

      const push = (chunk: string) => {
        if (!chunk) return;
        ctx.onOutput?.(chunk);
      };

      child.stdout?.on('data', (buf: Buffer) => {
        const text = buf.toString('utf8');
        if (stdout.length < 400_000) stdout += text;
        push(text);
      });
      child.stderr?.on('data', (buf: Buffer) => {
        const text = buf.toString('utf8');
        if (stderr.length < 200_000) stderr += text;
        push(text);
      });

      const timer = setTimeout(() => {
        timedOut = true;
        if (isWin && child.pid) {
          try { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
        }
        try { child.kill('SIGKILL'); } catch {}
      }, timeoutMs);

      const finish = (exitCode: number | null, spawnError?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        const durationMs = Date.now() - startedAt;
        const header = timedOut
          ? `命令超时（${Math.round(timeoutMs / 1000)} 秒）已被终止：${command}`
          : spawnError
            ? `命令启动失败：${spawnError}`
            : `退出码 ${exitCode}（耗时 ${durationMs}ms）：${command}`;

        const parts = [header];
        if (stdout.trim()) parts.push(`--- 标准输出 ---\n${clip(stdout.trimEnd())}`);
        if (stderr.trim()) parts.push(`--- 标准错误 ---\n${clip(stderr.trimEnd())}`);
        if (!stdout.trim() && !stderr.trim()) parts.push('（没有任何输出）');

        const note = timedOut
          ? '命令被超时终止，可能只完成了一部分；请检查是否留下半成品文件。'
          : exitCode !== 0
            ? '命令返回非 0 退出码，请根据标准错误判断原因，修好后重试。'
            : '';

        resolve(truncateOutput([...parts, note].filter(Boolean).join('\n')));
      };

      child.on('error', (err: Error) => finish(null, err.message));
      child.on('close', (code: number | null) => finish(code));
    });
  },
};

/** 供界面/接口复用的风险提示（不依赖执行） */
export function commandRisks(command: string) {
  return riskNotes(command);
}
