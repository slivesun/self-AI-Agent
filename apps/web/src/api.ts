const TOKEN_KEY = 'ra_token';

export function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
export function setToken(t: string) { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken() { localStorage.removeItem(TOKEN_KEY); }

async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options.headers as any) };
  // 访客路由用访客 token，管理路由用管理员 token
  const isVisitor = path.startsWith('/api/c/') || path.startsWith('/api/auth/visitor');
  const token = isVisitor
    ? (localStorage.getItem('ra_visitor_token') || '')
    : getToken();
  if (token && token !== 'anonymous') headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(path, { ...options, headers });
  const json = await res.json();
  if (!json.ok) {
    const err: any = new Error(json.error || '请求失败');
    if (json.code) err.code = json.code;
    err.status = res.status;
    throw err;
  }
  return json.data;
}

export const api = {
  getDefaultLink: () => request('/api/default-link'),
  login: (username: string, password: string) =>
    request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  changePassword: (oldPassword: string, newPassword: string) =>
    request('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ oldPassword, newPassword }) }),

  getProfile: () => request('/api/admin/profile'),
  saveProfile: (profile: any) => request('/api/admin/profile', { method: 'PUT', body: JSON.stringify({ profile }) }),
  publishProfile: (profile?: any) =>
    request('/api/admin/profile/publish', {
      method: 'POST',
      ...(profile ? { body: JSON.stringify({ profile }) } : {}),
    }),

  getKnowledge: () => request('/api/admin/knowledge'),
  getKnowledgeDoc: (id: string) => request(`/api/admin/knowledge/${id}`),
  deleteKnowledge: (id: string) => request(`/api/admin/knowledge/${id}`, { method: 'DELETE' }),
  updateKnowledgeTags: (id: string, tags: string[]) => request(`/api/admin/knowledge/${id}/tags`, { method: 'PUT', body: JSON.stringify({ tags }) }),
  getPersona: () => request('/api/admin/persona'),
  savePersona: (persona: any) => request('/api/admin/persona', { method: 'PUT', body: JSON.stringify({ persona }) }),

  getQA: () => request('/api/admin/qa'),
  createQA: (data: any) => request('/api/admin/qa', { method: 'POST', body: JSON.stringify(data) }),
  updateQA: (id: string, data: any) => request(`/api/admin/qa/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteQA: (id: string) => request(`/api/admin/qa/${id}`, { method: 'DELETE' }),

  getLinks: () => request('/api/admin/links'),
  createLink: (data: any) => request('/api/admin/links', { method: 'POST', body: JSON.stringify(data) }),
  updateLink: (id: string, data: any) => request(`/api/admin/links/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteLink: (id: string) => request(`/api/admin/links/${id}`, { method: 'DELETE' }),

  getAnalytics: () => request('/api/admin/analytics/summary'),
  getSessionMessages: (sessionId: string) => request(`/api/admin/sessions/${sessionId}/messages`),

  getLlmSettings: () => request('/api/admin/settings/llm'),
  saveLlmSettings: (data: { apiKey?: string; model?: string; clearApiKey?: boolean }) =>
    request('/api/admin/settings/llm', { method: 'PUT', body: JSON.stringify(data) }),

  visitorMe: () => request('/api/auth/visitor/me'),
  visitorInit: (slug: string, data: { visitorId?: string; code?: string }) =>
    request(`/api/c/${slug}/session`, { method: 'POST', body: JSON.stringify(data) }),
  visitorSend: (slug: string, data: { sessionId: string; visitorId?: string; content: string; model?: string }) =>
    request(`/api/c/${slug}/messages`, { method: 'POST', body: JSON.stringify(data) }),
  visitorSessions: (slug: string, visitorId: string) =>
    request(`/api/c/${slug}/sessions?visitorId=${encodeURIComponent(visitorId)}`),
  visitorSessionMessages: (slug: string, sessionId: string, visitorId?: string) =>
    request(`/api/c/${slug}/sessions/${sessionId}/messages${visitorId ? `?visitorId=${encodeURIComponent(visitorId)}` : ''}`),
  visitorNewSession: (slug: string, visitorId: string) =>
    request(`/api/c/${slug}/session`, { method: 'POST', body: JSON.stringify({ visitorId, newSession: true }) }),
  visitorDeleteSession: (slug: string, sessionId: string) =>
    request(`/api/c/${slug}/sessions/${sessionId}`, { method: 'DELETE' }),
};

// SSE stream reader
// token 是发送消息时服务端返回的短时 streamToken（EventSource 不能带 Authorization 头，所以放 query）
export function streamRun(
  runId: string,
  streamToken: string,
  sessionId: string,
  onDelta: (text: string) => void,
  onCitations: (c: any[]) => void,
  onDone: () => void,
  onError?: () => void,
) {
  const es = new EventSource(
    `/api/runs/${encodeURIComponent(runId)}/events?sessionId=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(streamToken)}`,
  );
  let finished = false;
  es.addEventListener('delta', (e) => {
    const data = JSON.parse(e.data);
    onDelta(data.text);
  });
  es.addEventListener('citations', (e) => {
    const data = JSON.parse(e.data);
    onCitations(data.citations);
  });
  es.addEventListener('done', () => { finished = true; es.close(); onDone(); });
  es.onerror = () => {
    if (finished) return;
    es.close();
    onError?.();
  };
  return es;
}
