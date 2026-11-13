/** 专业版前端类型：与后端 /api/pro 返回结构一一对应 */

export type ProView = 'chat' | 'project' | 'task' | 'create' | 'assets' | 'settings';

export type ProTodoStatus = 'pending' | 'doing' | 'done';

export interface ProTodo {
  id: string;
  title: string;
  status: ProTodoStatus;
  note: string;
  sessionId: string | null;
  sort: number;
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
}

export interface ProTodoStats {
  pending: number;
  doing: number;
  done: number;
  total: number;
}

export interface ProToolRecord {
  id: string;
  name: string;
  label: string;
  level: 'R' | 'W' | 'X';
  args: string;
  status: 'running' | 'ok' | 'error' | 'denied';
  result: string;
  durationMs?: number;
  /** shell_run 边跑边推的实时输出 */
  output?: string;
}

/** 一次落盘改动（带 diff，可一键回滚） */
export interface ProChange {
  id: string;
  sessionId?: string | null;
  runId?: string | null;
  filePath: string;
  action: 'create' | 'edit' | 'overwrite' | 'delete';
  diff: string;
  backupPath?: string | null;
  rolledBackAt?: string | null;
  createdAt: string;
}

/** 产物：图片 / Word / HTML 设计稿 / PDF */
export interface ProArtifact {
  id: string;
  kind: 'image' | 'doc' | 'html' | 'pdf' | 'text' | 'other';
  title: string;
  mime: string;
  size: number;
  url: string;
  filePath?: string;
  sessionId?: string | null;
  runId?: string | null;
  meta?: any;
  createdAt?: string;
}

/** 项目扫描结果（项目视图） */
export interface ProProjectScan {
  root: string;
  files: number;
  dirs: number;
  totalBytes: number;
  truncated: boolean;
  byExt: { ext: string; count: number; bytes: number }[];
  top: { name: string; dir: boolean; size?: number }[];
  packageJson: { name?: string; version?: string; scripts?: string[]; deps: number; devDeps: number } | null;
  git: { branch?: string } | null;
  gitignoreRules: number;
  workspaceId?: string;
  label?: string;
}

export interface ProAttachment {
  name: string;
  path: string;
  size: number;
  mime: string;
}

export interface ProPermissionRequest {
  requestId: string;
  tool: string;
  level: string;
  preview: string;
  args: string;
  status: 'pending' | 'allowed' | 'denied';
}

export interface ProMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tools?: ProToolRecord[];
  changes?: ProChange[];
  artifacts?: ProArtifact[];
  attachments?: ProAttachment[];
  permission?: ProPermissionRequest;
  usage?: { estTokens: number; model: string };
  /** 本轮联网痕迹：搜索次数与引用链接 */
  search?: { enabled: boolean; count: number; fetches: number; links: { title: string; url: string }[] };
  /** 用户消息上的单轮联网开关快照（false = 这轮没联网） */
  searchEnabled?: boolean;
  streaming?: boolean;
  stopped?: boolean;
  error?: boolean;
  /** 最近一次收到模型输出（正文或思考）的时间戳，用来判断"卡壳多久了" */
  lastActivityAt?: number;
  /** 本轮模型已输出的思考字数（推理模型会先吐思考再吐正文，这段时间界面是空的） */
  thinkingChars?: number;
}

export interface ProSession {
  id: string;
  title: string;
  pinned: boolean;
  preview: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ProWorkspace {
  id: string;
  path: string;
  label: string;
  createdAt: string;
}

export interface ProSettings {
  permissionMode: 'readonly' | 'standard';
  searchEnabled: boolean;
  searchEngine: 'baidu' | 'bing';
  visionModel: string;
  /** 图像生成模型 ID；为空表示未配置（出图会明确报错） */
  imageModel: string;
  imageApiKeySet: boolean;
  /** 实际生效的模型（= modelOverride || inheritedModel） */
  model: string;
  /** 专业版自己选的模型；空字符串表示继承普通版 */
  modelOverride: string;
  /** 普通版当前模型（继承时用） */
  inheritedModel: string;
  /** 可选模型白名单 */
  modelOptions: string[];
  workspaces: ProWorkspace[];
  usage: { todayRuns: number; todayTokens: number; totalRuns: number; totalTokens: number };
}

export interface ProAuditRow {
  id: number;
  session_id: string | null;
  run_id: string | null;
  tool: string;
  level: string;
  args: string;
  status: string;
  duration_ms: number | null;
  created_at: string;
}
