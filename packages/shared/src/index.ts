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
