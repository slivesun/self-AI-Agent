// ===== 档案结构 =====
export type Profile = {
  basics: {
    name: string;
    title: string;
    city: string;
    email?: string;
    phone?: string;
    links: { type: 'github' | 'blog' | 'linkedin' | 'other'; url: string }[];
  };
  summary: string;
  experiences: Experience[];
  projects: Project[];
  skills: SkillGroup[];
  education: Education[];
  extras?: {
    openSource?: string[];
    talks?: string[];
    writings?: string[];
    certificates?: string[];
  };
  availability?: { status: string; preferRole: string; preferCity: string };
};

export type Experience = {
  id: string;
  company: string;
  role: string;
  start: string;
  end: string | null;
  highlights: string[];
  stack: string[];
  visibility: 'public' | 'private';
};

export type Project = {
  id: string;
  name: string;
  role: string;
  period: string;
  background: string;
  challenge: string;
  solution: string;
  result: string;
  stack: string[];
  links: { label: string; url: string }[];
  visibility: 'public' | 'private';
};

export type SkillGroup = {
  group: string;
  items: { name: string; level: 1 | 2 | 3 | 4 | 5; evidenceProjectId?: string }[];
};

export type Education = {
  school: string;
  degree: string;
  major: string;
  period: string;
};

// ===== Q&A =====
export type QAPair = {
  id: string;
  question: string;
  variants: string[];
  answer: string;
  tags: string[];
  enabled: boolean;
};

// ===== 人设与边界 =====
export type Persona = {
  systemPrompt: string;
  tone: string;
  hardConstraint: string;
  refusalTopics: string[];
  fallbackReply: string;
  temperature: number;
};

// ===== 分享链接 =====
export type ShareLink = {
  id: string;
  slug: string;
  label: string;
  ref: string;
  requireCode: boolean;
  code: string | null;
  expiresAt: string | null;
  enabled: boolean;
  createdAt: string;
};

// ===== 访客会话 =====
export type VisitorSession = {
  id: string;
  visitorId: string;
  shareLinkId: string | null;
  shareLabel: string | null;
  createdAt: string;
  messageCount: number;
};

export type VisitorMessage = {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
  answered: boolean;
  createdAt: string;
};

export type Citation = {
  type: 'experience' | 'project' | 'qa' | 'profile';
  id: string;
  label: string;
};

// ===== API 响应 =====
export type ApiResponse<T = unknown> = {
  ok: boolean;
  data?: T;
  error?: string;
};

export type LoginRequest = { username: string; password: string };
export type LoginResponse = { token: string; name: string };

export type SessionInitResponse = {
  visitorId: string;
  sessionId: string;
  profilePublic: PublicProfile;
};

export type PublicProfile = {
  name: string;
  title: string;
  city: string;
  summary: string;
  links: { type: string; url: string }[];
  experienceCount: number;
  projectCount: number;
  skills: { group: string; items: string[] }[];
};

export type UnansweredQuestion = {
  id: string;
  question: string;
  hitCount: number;
  lastSeen: string;
};

export type AnalyticsSummary = {
  todayVisitors: number;
  todayMessages: number;
  totalSessions: number;
  unanswered: UnansweredQuestion[];
  recentSessions: VisitorSession[];
};

// ===== 可选模型白名单 =====
// 后台「模型设置」下拉、访客端模型选择器都用这一份。
// 注意：服务端构建是逐文件转译、不做 bundle，运行时不能 import 本包的 TS 源码，
// 所以 apps/server/src/llm.ts 里有一份等价的 ALLOWED_MODELS，改这里时请同步修改。
export const MODEL_OPTIONS = [
  { value: 'doubao-seed-evolving', label: 'Doubao Evolving' },
  { value: 'doubao-seed-2-0-mini-260428', label: 'Doubao Mini' },
  { value: 'doubao-seed-2-0-lite-260428', label: 'Doubao Lite' },
  { value: 'kimi-k3-1-pro-261024', label: 'Kimi K3 Pro' },
  { value: 'glm-5-2-260617', label: 'GLM-5.2' },
];

export const DEFAULT_MODEL = 'doubao-seed-2-0-lite-260428';

export function isAllowedModel(value: string): boolean {
  return MODEL_OPTIONS.some(m => m.value === value);
}

export function modelLabel(value: string): string {
  return MODEL_OPTIONS.find(m => m.value === value)?.label || value;
}
