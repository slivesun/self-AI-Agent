import { adminTokenOrMember, request } from '../api';
import type {
  ProArtifact,
  ProAuditRow,
  ProAttachment,
  ProChange,
  ProMessage,
  ProProjectScan,
  ProSession,
  ProSettings,
  ProTodo,
  ProTodoStats,
  ProTodoStatus,
  ProWorkspace,
} from './types';

const P = '/api/pro';

/**
 * 专业版登录态来源：与普通版共用同一份账号。
 * 优先管理员 token（后台登录），其次普通版聊天页登录的会员 token；匿名访客（'anonymous'）不接受。
 */
export const proToken = adminTokenOrMember;

/** 专业版接口封装（登录态与普通版共用；token 取值见 proToken()，由 ../api 的 request 统一处理） */
export const proApi = {
  whoami: () => request<{ name: string; username: string; role: string }>(`${P}/whoami`),

  listSessions: () => request<{ list: ProSession[] }>(`${P}/sessions`),
  createSession: (title?: string) => request<ProSession>(`${P}/sessions`, { method: 'POST', body: JSON.stringify({ title }) }),
  renameSession: (id: string, patch: { title?: string; pinned?: boolean }) =>
    request<ProSession>(`${P}/sessions/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteSession: (id: string) => request<{ ok: boolean }>(`${P}/sessions/${id}`, { method: 'DELETE' }),

  listMessages: (id: string) => request<{ list: ProMessage[] }>(`${P}/sessions/${id}/messages`),
  sendMessage: (id: string, content: string, attachments: ProAttachment[] = [], search = true) =>
    request<{ runId: string; streamToken: string; userMsgId: string }>(`${P}/sessions/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, attachments, search }),
    }),

  decidePermission: (runId: string, requestId: string, decision: 'once' | 'session' | 'deny') =>
    request<{ ok: boolean }>(`${P}/runs/${runId}/permission`, {
      method: 'POST',
      body: JSON.stringify({ requestId, decision }),
    }),

  getSettings: () => request<ProSettings>(`${P}/settings`),
  saveSettings: (patch: {
    permissionMode?: 'readonly' | 'standard';
    searchEnabled?: boolean;
    searchEngine?: 'baidu' | 'bing';
    visionModel?: string;
    imageModel?: string;
    imageApiKey?: string;
    model?: string;
  }) =>
    request<ProSettings>(`${P}/settings`, { method: 'PUT', body: JSON.stringify(patch) }),

  listWorkspaces: () => request<{ list: ProWorkspace[] }>(`${P}/workspaces`),
  addWorkspace: (path: string, label?: string) =>
    request<ProWorkspace>(`${P}/workspaces`, { method: 'POST', body: JSON.stringify({ path, label }) }),
  removeWorkspace: (id: string) => request<{ ok: boolean }>(`${P}/workspaces/${id}`, { method: 'DELETE' }),
  scanWorkspace: (id: string) => request<ProProjectScan>(`${P}/workspaces/${id}/scan`),

  listChanges: (sessionId?: string, limit = 50) =>
    request<{ list: ProChange[] }>(
      `${P}/changes?limit=${limit}${sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : ''}`,
    ),
  rollbackChange: (id: string) =>
    request<{ changeId: string; filePath: string; action: string; message: string }>(`${P}/changes/${id}/rollback`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  checkShellRisk: (command: string) =>
    request<{ risks: string[] }>(`${P}/shell/risk`, { method: 'POST', body: JSON.stringify({ command }) }),

  listArtifacts: (options: { sessionId?: string; kind?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (options.sessionId) qs.set('sessionId', options.sessionId);
    if (options.kind) qs.set('kind', options.kind);
    qs.set('limit', String(options.limit || 60));
    return request<{ list: ProArtifact[] }>(`${P}/artifacts?${qs.toString()}`);
  },
  deleteArtifact: (id: string) => request<{ ok: boolean }>(`${P}/artifacts/${id}`, { method: 'DELETE' }),
  importArtifact: (path: string) =>
    request<{ id: string; url: string }>(`${P}/artifacts/import`, { method: 'POST', body: JSON.stringify({ path }) }),

  audit: (limit = 30) => request<{ list: ProAuditRow[] }>(`${P}/audit?limit=${limit}`),

  listTodos: (status?: string) =>
    request<{ list: ProTodo[]; stats: ProTodoStats }>(`${P}/todos${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  addTodo: (title: string, note = '') =>
    request<{ todo: ProTodo; list: ProTodo[]; stats: ProTodoStats }>(`${P}/todos`, {
      method: 'POST',
      body: JSON.stringify({ title, note }),
    }),
  updateTodo: (id: string, patch: { title?: string; status?: ProTodoStatus; note?: string }) =>
    request<{ todo: ProTodo; list: ProTodo[]; stats: ProTodoStats }>(`${P}/todos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteTodo: (id: string) =>
    request<{ list: ProTodo[]; stats: ProTodoStats }>(`${P}/todos/${id}`, { method: 'DELETE' }),
};

/** 产物文件地址（<img>/iframe 带不了请求头，token 走 query，服务端只对这条读接口放行） */
export function artifactUrl(id: string): string {
  const token = proToken();
  return `${P}/artifacts/${id}/file${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

/** 上传附件（图片分析用）。走原生 fetch，因为要发 FormData */
export async function uploadProFile(file: File): Promise<ProAttachment> {
  const form = new FormData();
  form.append('file', file);
  const token = proToken();
  const res = await fetch(`${P}/uploads`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const json = await res.json().catch(() => ({ ok: false, error: '上传失败' }));
  if (!json.ok) throw new Error(json.error || '上传失败');
  return json.data as ProAttachment;
}

/**
 * 订阅一次运行的事件流。
 * SSE 用不了自定义请求头，短时凭据走 query（服务端绑定 runId + sessionId）。
 * 注意：服务端的错误事件名是 run_error，避免和 EventSource 自带的 error 事件撞车。
 */
export function subscribeRun(
  runId: string,
  streamToken: string,
  handlers: Partial<
    Record<
      | 'start'
      | 'delta'
      | 'tool'
      | 'tool_output'
      | 'permission'
      | 'change'
      | 'change_rolled_back'
      | 'artifact'
      | 'search'
      | 'todo'
      | 'usage'
      | 'done'
      | 'run_error'
      | 'thinking'
      | 'stream_error',
      (data: any) => void
    >
  >,
): { close: () => void } {
  const url = `${P}/runs/${runId}/events?token=${encodeURIComponent(streamToken)}`;
  const es = new EventSource(url);
  let finished = false;
  const names: Array<keyof typeof handlers> = [
    'start',
    'delta',
    'tool',
    'tool_output',
    'permission',
    'change',
    'change_rolled_back',
    'artifact',
    'search',
    'todo',
    'usage',
    'done',
    'run_error',
    'thinking',
  ];
  for (const name of names) {
    const fn = handlers[name];
    if (!fn) continue;
    es.addEventListener(name, (ev: MessageEvent) => {
      if (name === 'done' || name === 'run_error') finished = true;
      let payload: any = {};
      try {
        payload = ev.data ? JSON.parse(ev.data) : {};
      } catch {
        payload = { raw: ev.data };
      }
      fn(payload);
    });
  }

  // 连接异常/后端提前关闭：不能一直停在"正在生成"，
  // 交给上层结束本轮并说明"以上是部分内容"，否则用户看到的就是回答说到一半卡死。
  es.addEventListener('error', () => {
    if (finished) return;
    finished = true;
    es.close();
    handlers.stream_error?.({ message: '与后端的连接中断' });
  });

  return { close: () => es.close() };
}
