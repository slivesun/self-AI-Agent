import { useCallback, useEffect, useRef, useState } from 'react';
import DesktopTitleBar from '../components/DesktopTitleBar';
import { AssetsIcon, CreateIcon, ProjectIcon, SettingsIcon, MessageIcon, TaskIcon } from '../components/ProIcons';
import { useTheme } from '../theme';
import { proApi, subscribeRun, uploadProFile } from './api';
import type {
  ProArtifact,
  ProAttachment,
  ProAuditRow,
  ProChange,
  ProMessage,
  ProSession,
  ProSettings,
  ProToolRecord,
  ProView,
} from './types';
import ArtifactViewer from './components/ArtifactViewer';
import AssetsView from './components/AssetsView';
import ChatPane from './components/ChatPane';
import CreateView from './components/CreateView';
import ProjectView from './components/ProjectView';
import SessionPanel from './components/SessionPanel';
import SettingsView from './components/SettingsView';
import TaskView from './components/TaskView';

const NAV: { key: ProView; label: string; icon: (p: { size?: number }) => JSX.Element }[] = [
  { key: 'chat', label: '会话', icon: MessageIcon },
  { key: 'project', label: '项目', icon: ProjectIcon },
  { key: 'task', label: '任务', icon: TaskIcon },
  { key: 'create', label: '创作', icon: CreateIcon },
  { key: 'assets', label: '素材', icon: AssetsIcon },
  { key: 'settings', label: '设置', icon: SettingsIcon },
];

function serverToMessage(raw: any): ProMessage {
  const meta = raw.meta && typeof raw.meta === 'object' ? raw.meta : {};
  return {
    id: raw.id,
    role: raw.role,
    content: raw.content || '',
    tools: Array.isArray(meta.tools) ? meta.tools : undefined,
    changes: Array.isArray(meta.changes) ? meta.changes : undefined,
    artifacts: Array.isArray(meta.artifacts) ? meta.artifacts : undefined,
    attachments: Array.isArray(meta.attachments) ? meta.attachments : undefined,
    usage: meta.usage,
    search: meta.search,
    searchEnabled: typeof meta.searchEnabled === 'boolean' ? meta.searchEnabled : undefined,
    stopped: Boolean(meta.stopped),
    error: Boolean(meta.error),
  };
}

export default function ProApp() {
  const { dark, toggle: toggleTheme } = useTheme({ sync: true });

  const [view, setView] = useState<ProView>('chat');
  const [sessions, setSessions] = useState<ProSession[]>([]);
  const [currentId, setCurrentId] = useState('');
  const [messages, setMessages] = useState<ProMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<ProSettings | null>(null);
  const [panelWidth, setPanelWidth] = useState(260);
  const [panelOpen, setPanelOpen] = useState(true);
  const [audit, setAudit] = useState<ProAuditRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [artifacts, setArtifacts] = useState<ProArtifact[]>([]);
  const [artifactFilter, setArtifactFilter] = useState('');
  const [artifactsLoading, setArtifactsLoading] = useState(false);
  const [viewer, setViewer] = useState<ProArtifact | null>(null);
  /** 输入区的单轮联网开关：跟随总开关；用户可单独关掉本轮 */
  const [searchOn, setSearchOn] = useState(true);
  /** 助手改了任务面板就 +1，让任务视图重新拉数据 */
  const [todoReloadKey, setTodoReloadKey] = useState(0);
  const [toast, setToast] = useState('');
  const [authError, setAuthError] = useState('');

  const streamRef = useRef<{ close: () => void } | null>(null);
  const runIdRef = useRef('');

  const showToast = useCallback((text: string) => {
    setToast(text);
    setTimeout(() => setToast((prev) => (prev === text ? '' : prev)), 2400);
  }, []);

  // ---- 数据加载 ----
  const refreshSettings = useCallback(async () => {
    const data = await proApi.getSettings();
    setSettings(data);
    setSearchOn((prev) => (data.searchEnabled ? prev : false));
  }, []);

  const refreshSessions = useCallback(async () => {
    const data = await proApi.listSessions();
    setSessions(data.list);
    return data.list;
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await proApi.whoami();
      } catch (err: any) {
        if (alive) setAuthError(err?.code === 'FORBIDDEN' || err?.status === 401 ? '登录状态已失效，或当前账号还没完成首次改密。' : err?.message || '无法连接后端服务');
        return;
      }
      try {
        const [list] = await Promise.all([refreshSessions(), refreshSettings()]);
        if (!alive) return;
        const first = list[0];
        if (first) {
          setCurrentId(first.id);
          const data = await proApi.listMessages(first.id);
          if (alive) setMessages(data.list.map(serverToMessage));
        }
      } catch (err: any) {
        if (alive) showToast(err?.message || '加载失败');
      }
    })();
    return () => {
      alive = false;
    };
  }, [refreshSessions, refreshSettings, showToast]);

  // ---- 会话 ----
  const selectSession = async (id: string) => {
    if (busy) {
      showToast('回复还在进行，先停止再切换会话');
      return;
    }
    if (id === currentId) return;
    setCurrentId(id);
    setMessages([]);
    try {
      const data = await proApi.listMessages(id);
      setMessages(data.list.map(serverToMessage));
    } catch (err: any) {
      showToast(err?.message || '读取会话失败');
    }
  };

  const createSession = async () => {
    if (busy) {
      showToast('回复还在进行，先停止再新建会话');
      return;
    }
    try {
      const created = await proApi.createSession();
      setSessions((prev) => [created, ...prev]);
      setCurrentId(created.id);
      setMessages([]);
    } catch (err: any) {
      showToast(err?.message || '新建会话失败');
    }
  };

  const renameSession = async (id: string, title: string) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
    try {
      await proApi.renameSession(id, { title });
    } catch (err: any) {
      showToast(err?.message || '重命名失败');
    }
  };

  const togglePin = async (id: string, pinned: boolean) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, pinned } : s)));
    try {
      await proApi.renameSession(id, { pinned });
      await refreshSessions();
    } catch (err: any) {
      showToast(err?.message || '操作失败');
    }
  };

  const deleteSession = async (id: string) => {
    if (busy) {
      showToast('回复还在进行，先停止再删除会话');
      return;
    }
    try {
      await proApi.deleteSession(id);
      const rest = sessions.filter((s) => s.id !== id);
      setSessions(rest);
      if (currentId === id) {
        setCurrentId('');
        setMessages([]);
      }
    } catch (err: any) {
      showToast(err?.message || '删除失败');
    }
  };

  // ---- 对话 ----
  const patchAssistant = (assistantId: string, fn: (msg: ProMessage) => ProMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));
  };

  const mergeTool = (assistantId: string, payload: any) => {
    patchAssistant(assistantId, (msg) => {
      const list = msg.tools ? [...msg.tools] : [];
      const index = list.findIndex((t) => t.id === payload.id);
      const next: ProToolRecord = {
        id: payload.id,
        name: payload.name || (index >= 0 ? list[index].name : ''),
        label: payload.label || (index >= 0 ? list[index].label : payload.name || ''),
        level: payload.level || (index >= 0 ? list[index].level : 'R'),
        args: payload.args || (index >= 0 ? list[index].args : '{}'),
        status: payload.status,
        result: payload.result ?? (index >= 0 ? list[index].result : ''),
        durationMs: payload.durationMs,
        output: index >= 0 ? list[index].output : undefined,
      };
      if (index >= 0) list[index] = { ...list[index], ...next };
      else list.push(next);
      return { ...msg, tools: list };
    });
  };

  /** shell_run 的实时输出：按 tool id 增量拼到卡片上 */
  const appendToolOutput = (assistantId: string, payload: any) => {
    if (!payload?.id) return;
    patchAssistant(assistantId, (msg) => {
      const list = (msg.tools || []).map((t) =>
        t.id === payload.id
          ? { ...t, output: `${t.output || ''}${payload.chunk || ''}`.slice(-8000) }
          : t,
      );
      return { ...msg, tools: list };
    });
  };

  /** 产物：追加到本条回复，并刷新素材库 */
  const appendArtifact = (assistantId: string, payload: any) => {
    const artifact: ProArtifact = {
      id: payload.id,
      kind: payload.kind || 'other',
      title: payload.title || '产物',
      mime: payload.mime || '',
      size: payload.size || 0,
      url: payload.url || `/api/pro/artifacts/${payload.id}/file`,
      filePath: payload.filePath,
      createdAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    };
    patchAssistant(assistantId, (msg) => ({ ...msg, artifacts: [...(msg.artifacts || []), artifact] }));
    setArtifacts((prev) => [artifact, ...prev.filter((a) => a.id !== artifact.id)]);
  };

  const loadArtifacts = async (kind = artifactFilter) => {
    setArtifactsLoading(true);
    try {
      const data = await proApi.listArtifacts({ kind: kind || undefined, limit: 100 });
      setArtifacts(data.list);
    } catch (err: any) {
      showToast(err?.message || '读取素材失败');
    } finally {
      setArtifactsLoading(false);
    }
  };

  const deleteArtifact = async (id: string) => {
    try {
      await proApi.deleteArtifact(id);
      setArtifacts((prev) => prev.filter((a) => a.id !== id));
      setMessages((prev) =>
        prev.map((m) => (m.artifacts?.length ? { ...m, artifacts: m.artifacts.filter((a) => a.id !== id) } : m)),
      );
      showToast('已删除');
    } catch (err: any) {
      showToast(err?.message || '删除失败');
    }
  };

  /** 从素材库引用到会话：把实际路径交给助手，它才能接着改 */
  const useArtifactInChat = (artifact: ProArtifact) => {
    setView('chat');
    const path = artifact.filePath || '';
    send(
      `这是我之前让你生成的产物：${artifact.title}${path ? `，路径是 ${path}` : ''}。请先确认它现在的内容，然后按我的要求继续处理。`,
      [],
    );
  };

  /** 一次落盘：追加到本条回复的改动清单 */  const appendChange = (assistantId: string, payload: any) => {
    const change: ProChange = {
      id: payload.changeId,
      filePath: payload.path,
      action: payload.action || 'edit',
      diff: payload.diff || '',
      backupPath: payload.backupPath || null,
      rolledBackAt: null,
      createdAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    };
    patchAssistant(assistantId, (msg) => ({ ...msg, changes: [...(msg.changes || []), change] }));
  };

  const rollback = async (changeId: string) => {
    try {
      const result = await proApi.rollbackChange(changeId);
      const stamp = new Date().toLocaleString('zh-CN', { hour12: false });
      setMessages((prev) =>
        prev.map((m) =>
          m.changes?.some((c) => c.id === changeId)
            ? { ...m, changes: m.changes.map((c) => (c.id === changeId ? { ...c, rolledBackAt: stamp } : c)) }
            : m,
        ),
      );
      showToast(`${result.message}：${result.filePath.split(/[\\/]/).pop()}`);
    } catch (err: any) {
      showToast(err?.message || '回滚失败');
    }
  };

  const finishRun = (assistantId: string, replacementId?: string) => {
    patchAssistant(assistantId, (msg) => ({ ...msg, streaming: false }));
    if (replacementId) {
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, id: replacementId } : m)));
    }
    streamRef.current?.close();
    streamRef.current = null;
    runIdRef.current = '';
    setBusy(false);
    refreshSessions().catch(() => {});
  };

  const send = async (text: string, attachments: ProAttachment[]) => {
    let sessionId = currentId;
    if (!sessionId) {
      try {
        const created = await proApi.createSession(text.slice(0, 30));
        sessionId = created.id;
        setCurrentId(created.id);
        setSessions((prev) => [created, ...prev]);
      } catch (err: any) {
        showToast(err?.message || '创建会话失败');
        return;
      }
    }

    const localUserId = `local-user-${Date.now()}`;
    const assistantId = `local-assistant-${Date.now()}`;
    // 本轮联网：总开关关着就是 false；开着则跟随输入区的单轮开关
    const turnSearch = Boolean(settings?.searchEnabled) && searchOn;
    setMessages((prev) => [
      ...prev,
      { id: localUserId, role: 'user', content: text, attachments, searchEnabled: turnSearch },
      { id: assistantId, role: 'assistant', content: '', tools: [], streaming: true, lastActivityAt: Date.now(), thinkingChars: 0, search: turnSearch ? { enabled: true, count: 0, fetches: 0, links: [] } : { enabled: false, count: 0, fetches: 0, links: [] } },
    ]);
    setBusy(true);

    try {
      const run = await proApi.sendMessage(sessionId, text, attachments, turnSearch);
      runIdRef.current = run.runId;
      setMessages((prev) => prev.map((m) => (m.id === localUserId ? { ...m, id: run.userMsgId } : m)));

      streamRef.current = subscribeRun(run.runId, run.streamToken, {
        delta: ({ text: chunk }) =>
          patchAssistant(assistantId, (m) => ({ ...m, content: m.content + chunk, lastActivityAt: Date.now() })),
        // 推理模型的思考流：只用来证明"它还在动"，不并进正文
        thinking: ({ text: piece }) =>
          patchAssistant(assistantId, (m) => ({
            ...m,
            lastActivityAt: Date.now(),
            thinkingChars: (m.thinkingChars || 0) + String(piece || '').length,
          })),
        tool: (payload) => {
          patchAssistant(assistantId, (m) => ({ ...m, lastActivityAt: Date.now() }));
          mergeTool(assistantId, payload);
        },
        tool_output: (payload) => {
          patchAssistant(assistantId, (m) => ({ ...m, lastActivityAt: Date.now() }));
          appendToolOutput(assistantId, payload);
        },
        change: (payload) => appendChange(assistantId, payload),
        artifact: (payload) => appendArtifact(assistantId, payload),
        todo: () => setTodoReloadKey((v) => v + 1),
        search: (payload: any) =>
          patchAssistant(assistantId, (m) => {
            const current = m.search || { enabled: true, count: 0, fetches: 0, links: [] };
            const isFetch = payload.engine === 'fetch';
            return {
              ...m,
              search: {
                ...current,
                enabled: true,
                count: current.count + (isFetch ? 0 : 1),
                fetches: current.fetches + (isFetch ? 1 : 0),
                links: [...current.links, ...(Array.isArray(payload.items) ? payload.items : [])].slice(0, 15),
              },
            };
          }),
        change_rolled_back: ({ changeId }) => {
          const stamp = new Date().toLocaleString('zh-CN', { hour12: false });
          patchAssistant(assistantId, (m) => ({
            ...m,
            changes: m.changes?.map((c) => (c.id === changeId ? { ...c, rolledBackAt: stamp } : c)),
          }));
        },
        permission: (payload) =>
          patchAssistant(assistantId, (m) => ({
            ...m,
            permission: {
              requestId: payload.requestId,
              tool: payload.tool,
              level: payload.level,
              preview: payload.preview,
              args: payload.args,
              status: 'pending',
            },
          })),
        usage: (payload) =>
          patchAssistant(assistantId, (m) => ({ ...m, usage: { estTokens: payload.estTokens, model: payload.model } })),
        done: ({ messageId }) => finishRun(assistantId, messageId),
        stream_error: ({ message }) => {
          patchAssistant(assistantId, (m) => ({
            ...m,
            content: m.content
              ? `${m.content}\n\n> ⚠️ ${message}，以上是已收到的部分内容。`
              : `运行中断：${message}`,
            error: true,
          }));
          finishRun(assistantId);
        },
        run_error: ({ message }) => {
          patchAssistant(assistantId, (m) => ({ ...m, content: `运行失败：${message}`, error: true }));
          finishRun(assistantId);
        },
      });
    } catch (err: any) {
      patchAssistant(assistantId, (m) => ({ ...m, content: `发送失败：${err?.message || '未知错误'}`, error: true }));
      finishRun(assistantId);
    }
  };

  const stop = () => {
    streamRef.current?.close();
    streamRef.current = null;
    setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false, stopped: true } : m)));
    setBusy(false);
    refreshSessions().catch(() => {});
  };

  const decide = async (decision: 'once' | 'session' | 'deny') => {
    const target = messages.find((m) => m.permission && m.permission.status === 'pending');
    if (!target?.permission || !runIdRef.current) return;
    const requestId = target.permission.requestId;
    const mark = (status: 'allowed' | 'denied') =>
      setMessages((prev) =>
        prev.map((m) =>
          m.permission?.requestId === requestId ? { ...m, permission: { ...m.permission, status } } : m,
        ),
      );
    mark(decision === 'deny' ? 'denied' : 'allowed');
    try {
      await proApi.decidePermission(runIdRef.current, requestId, decision);
    } catch (err: any) {
      showToast(err?.message || '授权失败');
    }
  };

  // ---- 设置 ----
  const saveSettings = async (patch: {
    permissionMode?: 'readonly' | 'standard';
    searchEnabled?: boolean;
    searchEngine?: 'baidu' | 'bing';
    visionModel?: string;
    imageModel?: string;
    imageApiKey?: string;
    model?: string;
  }) => {
    try {
      const next = await proApi.saveSettings(patch);
      // PUT 只回传可写字段，这里合并而不是整体替换，避免把 model / workspaces / usage 冲掉
      setSettings((prev: any) => (prev ? { ...prev, ...next } : next));
      if (typeof next.searchEnabled === 'boolean') setSearchOn(next.searchEnabled);
      showToast('已保存');
    } catch (err: any) {
      showToast(err?.message || '保存失败');
    }
  };

  const addWorkspace = async (path: string, label: string) => {
    try {
      await proApi.addWorkspace(path, label || undefined);
      await refreshSettings();
      showToast('工作区已添加');
      return null;
    } catch (err: any) {
      return err?.message || '添加失败';
    }
  };

  const removeWorkspace = async (id: string) => {
    try {
      await proApi.removeWorkspace(id);
      await refreshSettings();
    } catch (err: any) {
      showToast(err?.message || '移除失败');
    }
  };

  const loadAudit = async () => {
    setAuditLoading(true);
    try {
      const data = await proApi.audit(30);
      setAudit(data.list);
    } catch (err: any) {
      showToast(err?.message || '读取审计失败');
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    if (view === 'settings' && audit.length === 0) loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    if ((view === 'assets' || view === 'create') && artifacts.length === 0) loadArtifacts('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const currentSession = sessions.find((s) => s.id === currentId) || null;

  return (
    <div className="app-shell">
      <DesktopTitleBar />
      <div className="app-content">
        <div className="pro-shell">
          <aside className="pro-sidebar">
            <div className="pro-nav">
              {NAV.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`pro-nav-btn${view === item.key ? ' active' : ''}`}
                    onClick={() => setView(item.key)}
                    title={item.label}
                  >
                    <span className="pro-nav-icon">
                      <Icon size={20} />
                    </span>
                    <span className="pro-nav-label">{item.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="pro-sidebar-foot">
              <button type="button" className="pro-theme-btn" onClick={toggleTheme} title="切换主题">
                {dark ? '☀' : '☾'}
              </button>
              <span className="pro-sidebar-mark">PRO</span>
            </div>
          </aside>

          <div className="pro-main pro-main-workbench">
            {authError ? (
              <div className="coming-soon">
                <div className="coming-soon-card">
                  <h2>需要先登录</h2>
                  <p>{authError}</p>
                  <div className="coming-soon-actions">
                    <button type="button" className="pro-btn" onClick={() => { window.location.href = '/login'; }}>
                      去普通版登录
                    </button>
                    <button type="button" className="pro-btn ghost" onClick={() => window.location.reload()}>
                      刷新重试
                    </button>
                  </div>
                  <p className="coming-soon-hint">
                    登录态与普通版共用：在普通版登录一次（管理员或聊天页账号都行），回到这里刷新即可，不用单独登录。
                  </p>
                </div>
              </div>
            ) : view === 'chat' ? (
              <>
                <ChatPane
                  session={currentSession}
                  messages={messages}
                  busy={busy}
                  model={settings?.model || ''}
                  permissionMode={settings?.permissionMode || 'standard'}
                  onSend={send}
                  onStop={stop}
                  onDecide={decide}
                  onUpload={uploadProFile}
                  onRollback={rollback}
                  onOpenArtifact={setViewer}
                  searchEnabled={Boolean(settings?.searchEnabled)}
                  searchOn={searchOn}
                  onToggleSearch={() => setSearchOn((v) => !v)}
                />
                {panelOpen ? (
                  <SessionPanel
                    sessions={sessions}
                    currentId={currentId}
                    width={panelWidth}
                    busy={busy}
                    onSelect={selectSession}
                    onCreate={createSession}
                    onRename={renameSession}
                    onTogglePin={togglePin}
                    onDelete={deleteSession}
                    onResize={setPanelWidth}
                    onCollapse={() => setPanelOpen(false)}
                  />
                ) : (
                  <button type="button" className="pro-panel-expand" onClick={() => setPanelOpen(true)} title="展开会话列表">
                    ‹
                  </button>
                )}
              </>
            ) : view === 'project' ? (
              <ProjectView
                workspaces={settings?.workspaces || []}
                onGotoSettings={() => setView('settings')}
                onAsk={(text) => {
                  setView('chat');
                  send(text, []);
                }}
              />
            ) : view === 'task' ? (
              <TaskView
                reloadKey={todoReloadKey}
                onAskAssistant={(text) => {
                  setView('chat');
                  send(text, []);
                }}
              />
            ) : view === 'create' ? (
              <CreateView
                settings={settings}
                artifacts={artifacts}
                onAsk={(text) => {
                  setView('chat');
                  send(text, []);
                }}
                onOpenArtifact={setViewer}
                onGotoSettings={() => setView('settings')}
              />
            ) : view === 'assets' ? (
              <AssetsView
                artifacts={artifacts}
                loading={artifactsLoading}
                filter={artifactFilter}
                onFilterChange={(kind) => {
                  setArtifactFilter(kind);
                  loadArtifacts(kind);
                }}
                onOpenArtifact={setViewer}
                onDeleteArtifact={deleteArtifact}
                onRefresh={() => loadArtifacts()}
                onUseInChat={useArtifactInChat}
              />
            ) : (
              <SettingsView
                settings={settings}
                audit={audit}
                auditLoading={auditLoading}
                onSave={saveSettings}
                onAddWorkspace={addWorkspace}
                onRemoveWorkspace={removeWorkspace}
                onLoadAudit={loadAudit}
              />
            )}
          </div>
        </div>
      </div>
      {toast ? <div className="app-toast">{toast}</div> : null}
      <ArtifactViewer artifact={viewer} onClose={() => setViewer(null)} />
    </div>
  );
}
