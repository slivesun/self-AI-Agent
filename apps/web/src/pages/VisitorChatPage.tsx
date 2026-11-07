import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { api, streamRun } from '../api';

type Message = {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  citations: { type: string; id: string; label: string }[];
  streaming?: boolean;
  thinking?: boolean;
  thought?: string;
  error?: boolean;
  failedQuery?: string;
  stopped?: boolean;
};

type SessionItem = {
  id: string;
  title: string;
  lastMessage: string;
  createdAt: string;
};

export default function VisitorChatPage() {
  const { slug } = useParams();
  const [profile, setProfile] = useState<any>(null);
  const [sessionId, setSessionId] = useState('');
  const [visitorId, setVisitorId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [model, setModel] = useState('doubao-seed-2-0-mini-260428');
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 768);
  const [sidebarWidth, setSidebarWidth] = useState(22); // 百分比
  const [dark, setDark] = useState(localStorage.getItem('ra_dark') === '1');
  const draggingRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<any>(null);
  const stoppedRef = useRef(false);

  const MODELS = [
    { value: 'doubao-seed-evolving', label: 'Doubao Evolving' },
    { value: 'doubao-seed-2-0-mini-260428', label: 'Doubao Mini' },
    { value: 'doubao-seed-2-0-lite-260428', label: 'Doubao Lite' },
    { value: 'kimi-k3-1-pro-261024', label: 'Kimi K3 Pro' },
    { value: 'glm-5-2-260617', label: 'GLM-5.2' },
  ];

  useEffect(() => { initSession(); }, [slug]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  // 组件卸载时关闭 SSE，防止状态泄漏
  useEffect(() => () => { if (esRef.current) esRef.current.close(); }, []);

  // 深色模式
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('ra_dark', dark ? '1' : '0');
  }, [dark]);

  // 侧边栏拖拽
  const onDragStart = (e: React.MouseEvent) => { e.preventDefault(); draggingRef.current = true; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; };
  const onDragMove = (e: MouseEvent) => {
    if (!draggingRef.current) return;
    const pct = (e.clientX / window.innerWidth) * 100;
    if (pct < 12) { setSidebarOpen(false); draggingRef.current = false; document.body.style.cursor = ''; document.body.style.userSelect = ''; }
    else setSidebarWidth(Math.min(30, Math.max(15, pct)));
  };
  const onDragEnd = () => { draggingRef.current = false; document.body.style.cursor = ''; document.body.style.userSelect = ''; };
  useEffect(() => {
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
    return () => { document.removeEventListener('mousemove', onDragMove); document.removeEventListener('mouseup', onDragEnd); };
  }, []);

  const initSession = async () => {
    try {
      const existingVisitor = localStorage.getItem('ra_visitor_id') || '';
      const data = await api.visitorInit(slug!, { visitorId: existingVisitor });
      localStorage.setItem('ra_visitor_id', data.visitorId);
      setVisitorId(data.visitorId);
      setSessionId(data.sessionId);
      setProfile(data.profilePublic);
      setMessages([{
        id: 0, role: 'assistant',
        content: `你好！我是${data.profilePublic.name}的 AI 助手。你可以问我关于${data.profilePublic.title}的任何问题——项目细节、技术选型、工作经历都可以。`,
        citations: []
      }]);
      loadSessions(data.visitorId);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadSessions = async (vid: string) => {
    try {
      const data = await api.visitorSessions(slug!, vid);
      setSessions(data.sessions);
    } catch {}
  };

  const switchSession = async (sid: string) => {
    setSessionId(sid);
    try {
      const data = await api.visitorSessionMessages(slug!, sid);
      setMessages([
        { id: 0, role: 'assistant', content: `你好！我是${profile.name}的 AI 助手。你可以问我关于${profile.title}的任何问题——项目细节、技术选型、工作经历都可以。`, citations: [] },
        ...data.messages.map((m: any, i: number) => ({ id: i + 1, role: m.role, content: m.content, citations: [] }))
      ]);
    } catch {}
  };

  const newSession = async () => {
    try {
      const data = await api.visitorNewSession(slug!, visitorId);
      setSessionId(data.sessionId);
      setMessages([{
        id: 0, role: 'assistant',
        content: `你好！我是${profile.name}的 AI 助手。你可以问我关于${profile.title}的任何问题——项目细节、技术选型、工作经历都可以。`,
        citations: []
      }]);
      loadSessions(visitorId);
    } catch {}
  };

  const stopGenerating = () => {
    stoppedRef.current = true;
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setMessages(prev => prev.map(m => m.streaming ? { ...m, streaming: false, thinking: false, stopped: true, content: m.content || '已停止回答' } : m));
    setSending(false);
  };

  const send = async (retryText?: string, retryMsgId?: number) => {
    const text = retryText ?? input.trim();
    if (!text || sending) return;
    if (!retryText) setInput('');
    setSending(true);
    stoppedRef.current = false;

    const assistantMsgId = retryMsgId ?? Date.now() + 1;
    const assistantMsg: Message = { id: assistantMsgId, role: 'assistant', content: '', citations: [], streaming: true, thinking: true, error: false, stopped: false };
    if (retryText) {
      // 重试：替换原错误消息，不重复加用户消息
      setMessages(prev => prev.map(m => m.id === retryMsgId ? { ...assistantMsg } : m));
    } else {
      const userMsg: Message = { id: Date.now(), role: 'user', content: text, citations: [] };
      setMessages(prev => [...prev, userMsg, assistantMsg]);
    }

    try {
      const { runId } = await api.visitorSend(slug!, { sessionId, content: text, model });
      let firstToken = true;
      const es = streamRun(
        runId, sessionId,
        (delta) => {
          setMessages(prev => prev.map(m => {
            if (m.id !== assistantMsgId) return m;
            const newContent = firstToken ? delta : m.content + delta;
            firstToken = false;
            return { ...m, content: newContent, thinking: false, error: false };
          }));
        },
        (citations) => setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, citations } : m)),
        () => {
          if (stoppedRef.current) { setSending(false); return; }
          setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, streaming: false, thinking: false, thought: `模型：${MODELS.find(x => x.value === model)?.label || model}\n基于简历档案数据检索并组织回答` } : m));
          setSending(false);
          loadSessions(visitorId);
        },
        () => {
          // SSE 错误
          if (stoppedRef.current) { setSending(false); return; }
          setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, streaming: false, thinking: false, error: true, failedQuery: text, content: m.content || '服务器错误，请稍后重试' } : m));
          setSending(false);
        },
      );
      esRef.current = es;
    } catch (e: any) {
      setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: '服务器错误，请稍后重试', streaming: false, error: true, failedQuery: text } : m));
      setSending(false);
    }
  };

  const deleteSession = async (sid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.visitorDeleteSession(slug!, sid);
      setSessions(prev => prev.filter(s => s.id !== sid));
      if (sid === sessionId) {
        // 如果删的是当前会话，创建新会话
        const data = await api.visitorNewSession(slug!, visitorId);
        setSessionId(data.sessionId);
        setMessages([{ id: 0, role: 'assistant', content: `你好！我是${profile.name}的 AI 助手。`, citations: [] }]);
      }
    } catch {}
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>加载中...</div>;
  if (error) return <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>{error}</div>;

  return (
    <div className="chat-layout">
      {/* 移动端侧边栏遮罩 */}
      {sidebarOpen && <div className="sidebar-mask-mobile" onClick={() => setSidebarOpen(false)} />}

      {/* 侧边栏 */}
      <div className={`chat-sidebar ${sidebarOpen ? '' : 'collapsed'}`} style={sidebarOpen ? { width: `${sidebarWidth}%` } : {}}>
        <div className="sidebar-header">
          <span>会话历史</span>
        </div>
        <button className="new-chat-btn" onClick={newSession}>+ 新对话</button>
        <div className="session-list">
          {sessions.map(s => (
            <div
              key={s.id}
              className={`session-item ${s.id === sessionId ? 'active' : ''}`}
              onClick={() => switchSession(s.id)}
            >
              <div className="session-item-main">
                <div className="session-title">{s.title}</div>
                <div className="session-preview">{s.lastMessage || '暂无消息'}</div>
              </div>
              <button
                className="session-delete"
                onClick={(e) => deleteSession(s.id, e)}
                title="删除会话"
              >✕</button>
            </div>
          ))}
        </div>
        <div className="sidebar-drag-handle" onMouseDown={onDragStart} />
      </div>

      {/* 主聊天区 */}
      <div className="chat-page">
        <div className="chat-header">
          <button className="icon-btn menu-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>{profile.name} · {profile.title}</h2>
            <p style={{ margin: '4px 0 0', color: '#999', fontSize: 13 }}>
              {profile.city} · {profile.experienceCount} 段经历 / {profile.projectCount} 个项目
            </p>
          </div>
          <button className="icon-btn" onClick={() => setDark(!dark)}>{dark ? '☀' : '☾'}</button>
        </div>

        <div className="chat-messages">
          {messages.map(m => (
            <div key={m.id} className={`message-row ${m.role}`}>
              <div className={`bubble ${m.role} ${m.thinking ? 'thinking' : ''}`}>
                {m.thinking ? (
                  <div className="thinking-brain">
                    <span className="brain-icon">🧠</span> 大脑思考中
                    <span className="thinking-dots"><span /><span /><span /></span>
                  </div>
                ) : (
                  <>
                    <ReactMarkdown>{m.content}</ReactMarkdown>
                    {m.stopped && <div style={{ fontSize: 12, color: '#999', marginTop: 6 }}>— 已停止回答</div>}
                    {m.error && (
                      <div style={{ marginTop: 8 }}>
                        <button
                          onClick={() => { send(m.failedQuery || '', m.id); }}
                          style={{ padding: '4px 12px', fontSize: 12, cursor: 'pointer', borderRadius: 6, border: '1px solid #d9d9d9', background: '#fff' }}
                        >
                          重试
                        </button>
                      </div>
                    )}
                    {m.citations.length > 0 && (
                      <div>
                        {m.citations.map((c, i) => (
                          <span key={i} className="citation-tag" title="来源">{c.label}</span>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="chat-input-area">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="model-select"
            title="选择模型"
          >
            {MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="问我任何问题..."
            disabled={sending}
          />
          {sending ? (
            <button onClick={stopGenerating} style={{ background: '#ff4d4f', color: '#fff' }}>停止</button>
          ) : (
            <button onClick={() => send()} disabled={!input.trim()}>发送</button>
          )}
        </div>
      </div>
    </div>
  );
}
