import type { ToolDef } from './types.js';
import { fsList, fsRead, fsGlob, fsGrep, fsWrite, fsEdit } from './fs.js';
import { imageAnalyze } from './image.js';
import { shellRun } from './shell.js';
import { fsRestore } from './restore.js';
import { imageGenerate } from './media.js';
import { docExport, docRead } from './doc.js';
import { designRender } from './design.js';
import { webSearch, webFetch } from './web.js';
import { systemInfo, systemOpen, clipboardRead, clipboardWrite, screenCapture } from './system.js';
import { todoSet } from './todo.js';

/**
 * 工具注册表：Agent 循环只认这里的工具，新增能力必须同时补 schema 与权限级别。
 * P1：文件四件套 + 写/改 + 读图。
 * P2：加命令执行（X 级）与改动回滚（W 级）。
 * P3：加出图、Word 导出、文档读取、HTML 设计稿（产物统一进产物库）。
 * P4：加联网搜索与网页抓取（受总开关 + 单轮开关双重约束）；
 *     加系统控制（系统信息 / 打开目标 / 剪贴板 / 截屏）与任务清单。
 */
export const TOOL_LIST: ToolDef[] = [
  fsList,
  fsRead,
  fsGlob,
  fsGrep,
  fsWrite,
  fsEdit,
  fsRestore,
  shellRun,
  imageAnalyze,
  imageGenerate,
  designRender,
  docExport,
  docRead,
  webSearch,
  webFetch,
  systemInfo,
  systemOpen,
  clipboardRead,
  clipboardWrite,
  screenCapture,
  todoSet,
];

/** 联网类工具：开关关掉时必须整体从工具列表里摘掉（不是靠提示词约束） */
export const WEB_TOOL_NAMES = new Set(['web_search', 'web_fetch']);

const BY_NAME = new Map(TOOL_LIST.map((t) => [t.name, t]));

export function findTool(name: string): ToolDef | undefined {
  return BY_NAME.get(name);
}

/** 转成 OpenAI function calling 的 tools 定义；可传白名单（例如禁用联网时剔除联网工具） */
export function toOpenAITools(allowed?: Set<string>) {
  return TOOL_LIST.filter((tool) => !allowed || allowed.has(tool.name)).map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.schema,
    },
  }));
}
