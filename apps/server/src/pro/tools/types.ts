/** 工具层的公共类型定义：所有工具都通过同一套 schema 暴露给模型，走同一个权限网关。 */

export type ToolLevel = 'R' | 'W' | 'X';

export type PermissionDecision = 'once' | 'session' | 'deny';

/** 一次落盘改动：用于界面展示 diff 与一键回滚 */
export interface ToolChangeInput {
  /** 绝对路径（也接受工作区相对路径） */
  filePath: string;
  action: 'create' | 'edit' | 'overwrite' | 'delete';
  /** 写前备份；新建文件时为 null */
  backupPath: string | null;
  /** 统一 diff 文本 */
  diff: string;
}

export interface ToolContext {
  runId: string;
  sessionId: string;
  /** 已授权的工作区根目录（真实路径） */
  roots: string[];
  /** 额外可读目录（例如专业版上传目录：图片分析需要读） */
  extraRoots: string[];
  mode: 'readonly' | 'standard';
  /** 向用户请求授权（仅在需要确认时调用） */
  requestPermission(input: { tool: string; level: ToolLevel; args: any; preview: string }): Promise<PermissionDecision>;
  /** 写盘前备份：返回备份路径（文件不存在时返回 null） */
  backup(absPath: string): Promise<string | null>;
  /** 落一条审计 */
  audit(input: { tool: string; level: ToolLevel; args: string; status: string; durationMs?: number | null }): void;
  /** 记一条改动（带 diff + 备份），返回可回滚的 changeId */
  recordChange(input: ToolChangeInput): string;
  /** 向界面推送增量事件（例如 shell 的分段输出） */
  emit(event: string, data: any): void;
  /** 记一条联网搜索（消息上标注"已联网搜索 N 次"并带引用链接） */
  recordSearch?(entry: { query: string; engine: string; items: { title: string; url: string; site?: string }[] }): void;
  /** 本轮是否允许联网（总开关 + 单轮开关合并后的结果）；工具层据此硬拦截 */
  searchEnabled?: boolean;
  /** 本轮已发生的搜索次数（单轮上限 5 次） */
  searchCount?: number;
  /** 当前工具调用的实时输出回调（由 agent 在每次调用前挂上，长命令可边跑边看） */
  onOutput?: (chunk: string) => void;
}

export interface ToolDef {
  name: string;
  /** 中文名，用于界面展示 */
  label: string;
  description: string;
  level: ToolLevel;
  /** JSON Schema（OpenAI function calling 用） */
  schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  /** 权限确认卡上的一句话说明 */
  preview(args: any): string;
  run(args: any, ctx: ToolContext): Promise<string>;
}

/** 工具返回给模型的内容做截断，避免把超大输出灌进上下文（一次 run 最多 12 步，单步留下 8000 字很贵） */
export const MAX_TOOL_OUTPUT = 6000;

export function truncateOutput(text: string): string {
  if (text.length <= MAX_TOOL_OUTPUT) return text;
  return `${text.slice(0, MAX_TOOL_OUTPUT)}\n…（输出过长已截断，原始长度 ${text.length} 字符；需要更多请用 offset/limit 分段读）`;
}
