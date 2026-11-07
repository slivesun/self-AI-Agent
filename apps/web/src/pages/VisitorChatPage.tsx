import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { api, streamRun } from '../api';
import BrandMark from '../components/BrandMark';
import { MenuIcon, MoonIcon, SunIcon } from '../components/HeaderIcons';

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
  needLogin?: boolean;
};

type SessionItem = {
  id: string;
  title: string;
  lastMessage: string;
  createdAt: string;
  askedCount?: number;
};

// 账号 token 与匿名访客 id 分开存储：匿名 id 只代表游客身份，登录时不再被覆盖
const TOKEN_KEY = 'ra_visitor_token';
const ANON_KEY = 'ra_visitor_id';
const DEFAULT_LIMITS = { maxSessions: 5, maxQuestionsPerSession: 1 };

function ensureAnonId(excludeId?: string) {
  let id = localStorage.getItem(ANON_KEY);
  // 旧版本会把账号 id 写进匿名键，这里排除掉，避免退出登录后仍以账号身份读会话
  if (id && excludeId && id === excludeId) {
    localStorage.removeItem(ANON_KEY);
    id = null;
  }
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(ANON_KEY, id);
  }
  return id;
}

export default function VisitorChatPage() {
  const { slug } = useParams();
  const rememberFlag = localStorage.getItem('ra_visitor_remember') === '1';
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
  const [visitorToken, setVisitorToken] = useState(localStorage.getItem(TOKEN_KEY) || '');
  const [visitorUser, setVisitorUser] = useState<any>(null);
  const [identityMode, setIdentityMode] = useState<'guest' | 'user'>('guest');
  const [limits, setLimits] = useState(DEFAULT_LIMITS);
  const [loginPrompt, setLoginPrompt] = useState<null | 'question' | 'session'>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  // 账号/密码用非受控输入 + ref 读取，避免浏览器自动填充与 React 受控值互相覆盖导致输入框“点不进去/输入被清空”
  const rememberedUser = rememberFlag ? localStorage.getItem('ra_visitor_remember_user') || '' : '';
  const rememberedPass = rememberFlag ? localStorage.getItem('ra_visitor_remember_pass') || '' : '';
  const [rememberMe, setRememberMe] = useState(rememberFlag);
  const [agreed, setAgreed] = useState(false);
  const [showAgreement, setShowAgreement] = useState(false);
  const [registered, setRegistered] = useState<any>(null);
  const [userPanelOpen, setUserPanelOpen] = useState(false);
  const draggingRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<any>(null);
  const stoppedRef = useRef(false);
  const userPanelRef = useRef<HTMLDivElement>(null);
  const authUserRef = useRef<HTMLInputElement>(null);
  const authPassRef = useRef<HTMLInputElement>(null);
  const authNickRef = useRef<HTMLInputElement>(null);
  // 身份切换序号：异步请求返回时若身份已变，丢弃旧身份的结果，避免会话列表串号
  const identitySeqRef = useRef(0);

  const MODELS = [
    { value: 'doubao-seed-evolving', label: 'Doubao Evolving' },
    { value: 'doubao-seed-2-0-mini-260428', label: 'Doubao Mini' },
    { value: 'doubao-seed-2-0-lite-260428', label: 'Doubao Lite' },
    { value: 'kimi-k3-1-pro-261024', label: 'Kimi K3 Pro' },
    { value: 'glm-5-2-260617', label: 'GLM-5.2' },
  ];

  const greeting = (p: any): Message => ({
    id: 0, role: 'assistant',
    content: `你好！我是${p?.name || '这位候选人'}的 AI 助手。你可以问我关于${p?.title || 'TA'}的任何问题——项目细节、技术选型、工作经历都可以。`,
    citations: [],
  });

  // 组装会话消息：历史首条已是助手消息时不重复插入欢迎语
  const buildMessages = (p: any, history: { role: 'user' | 'assistant'; content: string }[]): Message[] => {
    const mapped: Message[] = history.map((m, i) => ({ id: i + 1, role: m.role, content: m.content, citations: [] }));
    if (history.length && history[0].role === 'assistant') return mapped;
    return [greeting(p), ...mapped];
  };

  const loadSessions = async (vid: string, seq?: number) => {
    try {
      const data = await api.visitorSessions(slug!, vid);
      if (seq !== undefined && seq !== identitySeqRef.current) return;
      setSessions(data.sessions);
    } catch {}
  };

  // 初始化会话上下文（登录/退出/游客切换时显式调用，传入对应身份的 id）
  const initContext = async (vid: string, mode: 'guest' | 'user') => {
    const seq = ++identitySeqRef.current;
    setLoading(true);
    setError('');
    try {
      const data = await api.visitorInit(slug!, { visitorId: vid || undefined });
      if (seq !== identitySeqRef.current) return;
      // 只有游客身份才把服务端返回的 id 存为匿名 id；账号 id 不再写入该键
      if (mode === 'guest') {
        localStorage.setItem(ANON_KEY, data.visitorId);
      } else if (localStorage.getItem(ANON_KEY) === data.visitorId) {
        // 历史遗留：匿名键曾被写成账号 id，清掉以免退出登录后串到账号会话
        localStorage.removeItem(ANON_KEY);
      }
      setVisitorId(data.visitorId);
      setIdentityMode(mode);
      setSessionId(data.sessionId);
      setProfile(data.profilePublic);
      if (data.limits) setLimits(data.limits);
      // 进入页面直接渲染最近活跃会话的历史记录
      const historyData = await api.visitorSessionMessages(
        slug!,
        data.sessionId,
        mode === 'guest' ? data.visitorId : undefined,
      );
      if (seq !== identitySeqRef.current) return;
      setMessages(buildMessages(data.profilePublic, historyData.messages || []));
      await loadSessions(data.visitorId, seq);
    } catch (e: any) {
      if (seq === identitySeqRef.current) setError(e.message);
    } finally {
      if (seq === identitySeqRef.current) setLoading(false);
    }
  };

  // 切换身份：先清空上一身份的会话状态，再按新身份初始化，避免会话列表串号
  const switchIdentity = async (mode: 'guest' | 'user', id: string) => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    stoppedRef.current = true;
    setSending(false);
    setIdentityMode(mode);
    setSessionId('');
    setMessages([]);
    setSessions([]);
    setLoginPrompt(null);
    setUserPanelOpen(false);
    await initContext(id, mode);
  };

  // 首次加载：有账号 token 时先取账号信息，用账号 id 初始化；游客则用匿名 id
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY) || '';
    if (!token) { setLoading(false); return; }
    if (token === 'anonymous') {
      initContext(ensureAnonId(), 'guest');
      return;
    }
    (async () => {
      try {
        const me = await api.visitorMe();
        setVisitorUser(me);
        setVisitorToken(token);
        await initContext(me.id, 'user');
      } catch (e: any) {
        // token 失效则回到登录页，不能悄悄降级成游客，否则会串到访客会话
        if (/未登录|token|无效|不存在/.test(e.message || '')) {
          localStorage.removeItem(TOKEN_KEY);
          setVisitorToken('');
          setLoading(false);
        } else {
          setError(e.message);
          setLoading(false);
        }
      }
    })();
  }, []); // eslint-disable-line

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  // 登录页显示时自动聚焦账号输入框，并清掉可能残留的拖拽样式
  useEffect(() => {
    if (!visitorToken) {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      const t = setTimeout(() => authUserRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [visitorToken]);
  // 组件卸载时关闭 SSE，防止状态泄漏
  useEffect(() => () => { if (esRef.current) esRef.current.close(); }, []);

  // 点击资料卡片以外的任何位置（或按 Esc）关闭卡片
  useEffect(() => {
    if (!userPanelOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (userPanelRef.current && !userPanelRef.current.contains(e.target as Node)) {
        setUserPanelOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setUserPanelOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [userPanelOpen]);

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

  const switchSession = async (sid: string) => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    stoppedRef.current = true;
    setSending(false);
    setSessionId(sid);
    try {
      const data = await api.visitorSessionMessages(slug!, sid, identityMode === 'guest' ? visitorId : undefined);
      setMessages(buildMessages(profile, data.messages || []));
    } catch {
      setMessages([greeting(profile)]);
    }
  };

  const newSession = async () => {
    // 访客会话数已达上限：直接引导登录，不再发请求
    if (identityMode === 'guest' && sessions.length >= limits.maxSessions) {
      setLoginPrompt('session');
      return;
    }
    try {
      const data = await api.visitorNewSession(slug!, visitorId);
      setSessionId(data.sessionId);
      setMessages([greeting(profile)]);
      loadSessions(visitorId);
    } catch (e: any) {
      if (e.code === 'GUEST_SESSION_LIMIT') { setLoginPrompt('session'); return; }
      const msgId = Date.now() + 1;
      setMessages(prev => [...prev, {
        id: msgId, role: 'assistant', content: e.message || '创建会话失败',
        citations: [], streaming: false, thinking: false, error: true,
      }]);
    }
  };

  // 访客当前会话是否已用完 1 次提问额度
  const guestQuotaUsed = identityMode === 'guest' && messages.some(m => m.role === 'user');

  const stopGenerating = () => {
    stoppedRef.current = true;
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setMessages(prev => prev.map(m => m.streaming ? { ...m, streaming: false, thinking: false, stopped: true, content: m.content || '已停止回答' } : m));
    setSending(false);
  };

  const send = async (retryText?: string, retryMsgId?: number) => {
    const text = retryText ?? input.trim();
    if (!text || sending) return;
    // 访客每个会话只能提问 1 次：发第二条前直接提示登录（重试同一条问题不受限）
    if (!retryText && identityMode === 'guest' && messages.some(m => m.role === 'user')) {
      setLoginPrompt('question');
      return;
    }
    if (!retryText) setInput('');
    setSending(true);
    stoppedRef.current = false;

    const assistantMsgId = retryMsgId ?? Date.now() + 1;
    const assistantMsg: Message = { id: assistantMsgId, role: 'assistant', content: '', citations: [], streaming: true, thinking: true, error: false, stopped: false };
    let sentUserMsgId: number | null = null;
    if (retryText) {
      // 重试：替换原错误消息，不重复加用户消息
      setMessages(prev => prev.map(m => m.id === retryMsgId ? { ...assistantMsg } : m));
    } else {
      sentUserMsgId = Date.now();
      const userMsg: Message = { id: sentUserMsgId, role: 'user', content: text, citations: [] };
      setMessages(prev => [...prev, userMsg, assistantMsg]);
    }

    try {
      const { runId } = await api.visitorSend(slug!, {
        sessionId,
        visitorId: identityMode === 'guest' ? visitorId : undefined,
        content: text,
        model,
      });
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
      const isRateLimit = e.code === 'GUEST_QUESTION_LIMIT' || /访客|未登录|注册|登录后/.test(e.message || '');
      if (isRateLimit && identityMode === 'guest') {
        // 服务端判定额度已用完：撤回本地乐观插入的用户消息和占位回答，弹出登录引导
        setMessages(prev => prev.filter(m => m.id !== assistantMsgId && m.id !== sentUserMsgId));
        setSending(false);
        setLoginPrompt('question');
        loadSessions(visitorId);
        return;
      }
      setMessages(prev => prev.map(m => m.id === assistantMsgId ? {
        ...m,
        content: '服务器错误，请稍后重试',
        streaming: false, thinking: false,
        error: true, failedQuery: text,
      } : m));
      setSending(false);
    }
  };

  const deleteSession = async (sid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // 访客会话不允许删除（额度固定为 5 个，删除会变相重置额度）
    if (identityMode === 'guest') return;
    // 只剩一条会话时不提供删除入口（按钮已隐藏，这里再兜一层）
    if (sessions.length <= 1) return;
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    stoppedRef.current = true;
    setSending(false);
    try {
      await api.visitorDeleteSession(slug!, sid);
      const remaining = sessions.filter(s => s.id !== sid);
      setSessions(remaining);
      if (sid === sessionId) {
        if (remaining.length > 0) {
          // 删掉的是当前会话：自动选中列表第一条
          await switchSession(remaining[0].id);
        } else {
          // 兜底（例如通过接口删光所有会话）：自动开一条新对话
          const data = await api.visitorNewSession(slug!, visitorId);
          setSessionId(data.sessionId);
          setMessages([greeting(profile)]);
        }
        loadSessions(visitorId);
      }
    } catch {}
  };

  // 8 个默认头像（圆形色块 + emoji）
  const AVATARS = ['🦊','🐱','🐼','🦁','🐯','🐨','🦄','🐸'];
  const [authAvatar, setAuthAvatar] = useState('0');

  const randomGen = () => {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let s = '';
    const len = 6 + Math.floor(Math.random() * 5);
    for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
    if (authUserRef.current) authUserRef.current.value = s;
  };

  const doRegister = async () => {
    const nickname = (authNickRef.current?.value || '').trim();
    const username = (authUserRef.current?.value || '').trim();
    const password = authPassRef.current?.value || '';
    if (!nickname) { alert('请输入昵称'); return; }
    if (!username || !password) { alert('请输入账号和密码'); return; }
    if (!agreed) { alert('请先阅读并同意用户协议'); return; }
    const res = await fetch('/api/auth/visitor/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname, username, password, avatar: authAvatar }),
    });
    const data = await res.json();
    if (data.ok) {
      localStorage.setItem(TOKEN_KEY, data.data.token);
      setVisitorToken(data.data.token);
      setVisitorUser(data.data);
      setRegistered(data.data);
      await switchIdentity('user', data.data.id);
    } else { alert(data.error); }
  };

  const doLogin = async () => {
    const username = (authUserRef.current?.value || '').trim();
    const password = authPassRef.current?.value || '';
    if (!username || !password) { alert('请输入账号和密码'); return; }
    if (!agreed) { alert('请先阅读并同意用户协议'); return; }
    const res = await fetch('/api/auth/visitor/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (data.ok) {
      localStorage.setItem(TOKEN_KEY, data.data.token);
      setVisitorToken(data.data.token);
      setVisitorUser(data.data);
      if (rememberMe) {
        localStorage.setItem('ra_visitor_remember', '1');
        localStorage.setItem('ra_visitor_remember_user', data.data.username || username);
        localStorage.setItem('ra_visitor_remember_pass', password);
      } else {
        localStorage.removeItem('ra_visitor_remember');
        localStorage.removeItem('ra_visitor_remember_user');
        localStorage.removeItem('ra_visitor_remember_pass');
      }
      // 登录后切换到该账号的会话列表（不使用匿名 id）
      await switchIdentity('user', data.data.id);
    } else { alert(data.error); }
  };

  const enterGuest = async () => {
    const anonId = ensureAnonId();
    localStorage.setItem(TOKEN_KEY, 'anonymous');
    setVisitorToken('anonymous');
    setVisitorUser(null);
    await switchIdentity('guest', anonId);
  };

  const logout = async () => {
    const prevUserId = visitorUser?.id;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.setItem(TOKEN_KEY, 'anonymous');
    setVisitorUser(null);
    setVisitorToken('anonymous');
    // 排除历史遗留的“匿名键 = 账号 id”，重新拿到真正的游客身份
    const anonId = ensureAnonId(prevUserId);
    await switchIdentity('guest', anonId);
  };

  // 打开登录/注册页（保留本地匿名 id，回来仍是同一个游客）
  const openAuthPage = () => {
    // 关掉还在跑的流式回答、并让在途的身份初始化结果失效，避免登录页被后台状态刷新打断输入
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    stoppedRef.current = true;
    identitySeqRef.current++;
    setSending(false);
    setLoading(false);
    localStorage.removeItem(TOKEN_KEY);
    setAuthMode('login');
    setVisitorToken('');
    setUserPanelOpen(false);
    setLoginPrompt(null);
  };

  // 未登录时显示登录注册页
  if (!visitorToken) {
    return (
      <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f7f8fa', padding: 20 }}>
        <div style={{ width: '100%', maxWidth: 400, background: '#fff', borderRadius: 16, padding: 32, boxShadow: '0 2px 16px rgba(0,0,0,0.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
            <BrandMark size={52} />
          </div>
          <h2 style={{ textAlign: 'center', marginBottom: 8, fontSize: 22 }}>个人AI助手</h2>
          <p style={{ textAlign: 'center', color: '#999', marginBottom: 24, fontSize: 13 }}>登录后与 AI 面试官对话</p>

          {registered ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ background: '#eef3ff', padding: 16, borderRadius: 8, marginBottom: 16 }}>
                <p style={{ color: '#2b5cff', fontWeight: 600, marginBottom: 8 }}>注册成功！请保存账号密码</p>
                <p style={{ fontSize: 14, color: '#333' }}>账号：<strong>{registered.username}</strong></p>
              </div>
              <button onClick={() => setRegistered(null)} style={{ width: '100%', padding: 12, background: '#2b5cff', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, cursor: 'pointer' }}>进入对话</button>
            </div>
          ) : (
            <>
              {authMode === 'register' && (
                <div style={{ marginBottom: 16, textAlign: 'center' }}>
                  <div style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>选择头像</div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                    {AVATARS.map((emoji, i) => (
                      <div key={i} onClick={() => setAuthAvatar(String(i))}
                        style={{ width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, cursor: 'pointer',
                          background: authAvatar === String(i) ? '#eef3ff' : '#f5f5f5',
                          border: authAvatar === String(i) ? '2px solid #2b5cff' : '2px solid transparent' }}>
                        {emoji}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {authMode === 'register' && (
                <input ref={authNickRef} name="nickname" placeholder="昵称" defaultValue=""
                  style={{ width: '100%', boxSizing: 'border-box', padding: 10, marginBottom: 12, border: '1px solid #e5e8ef', borderRadius: 8, fontSize: 14 }} />
              )}

              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input ref={authUserRef} name="username" autoComplete="username" defaultValue={rememberedUser}
                  placeholder={authMode === 'register' ? '设置账号（3-16位）' : '账号'}
                  style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', padding: 10, border: '1px solid #e5e8ef', borderRadius: 8, fontSize: 14 }} />
                {authMode === 'register' && (
                  <button onClick={randomGen} style={{ padding: '0 12px', background: '#f0f0f0', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, color: '#666' }}>随机</button>
                )}
              </div>

              <input ref={authPassRef} name="password" autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                placeholder={authMode === 'register' ? '设置密码（6-32位）' : '密码'} type="password" defaultValue={rememberedPass}
                onKeyDown={e => { if (e.key === 'Enter') { if (authMode === 'register') doRegister(); else doLogin(); } }}
                style={{ width: '100%', boxSizing: 'border-box', padding: 10, marginBottom: 12, border: '1px solid #e5e8ef', borderRadius: 8, fontSize: 14 }} />

              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, fontSize: 13, color: '#666' }}>
                <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
                我已阅读并同意
                <span onClick={() => setShowAgreement(true)} style={{ color: '#2b5cff', cursor: 'pointer' }}>《用户服务协议》</span>
              </label>
              {authMode === 'login' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, fontSize: 13, color: '#666' }}>
                  <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} />
                  记住账号密码
                </label>
              )}

              <button onClick={authMode === 'register' ? doRegister : doLogin}
                style={{ width: '100%', padding: 12, background: '#2b5cff', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, cursor: 'pointer' }}>
                {authMode === 'register' ? '注册并进入' : '登录'}
              </button>

              <p style={{ textAlign: 'center', marginTop: 16, fontSize: 13, color: '#999' }}>
                {authMode === 'register' ? '已有账号？' : '没有账号？'}
                <span onClick={() => setAuthMode(authMode === 'register' ? 'login' : 'register')} style={{ color: '#2b5cff', cursor: 'pointer' }}>
                  {authMode === 'register' ? '去登录' : '注册新账号'}
                </span>
              </p>

              <div style={{ textAlign: 'center', marginTop: 12 }}>
                <span onClick={enterGuest}
                  style={{ color: '#999', cursor: 'pointer', fontSize: 13 }}>
                  游客体验（{limits.maxSessions} 个会话，每会话 {limits.maxQuestionsPerSession} 个问题）→
                </span>
              </div>
            </>
          )}
        </div>

        {/* 协议弹框 */}
        {showAgreement && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }} onClick={() => setShowAgreement(false)}>
            <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 500, maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
              <h3 style={{ marginBottom: 12 }}>用户服务协议</h3>
              <div style={{ fontSize: 13, lineHeight: 1.8, color: '#555' }}>
                <p><strong>1. 服务内容</strong>：本服务提供 AI 简历对话功能，帮助求职者与面试官进行模拟面试交流。</p>
                <p><strong>2. 账号安全</strong>：用户应妥善保管账号密码，因个人泄露导致的损失由用户自行承担。</p>
                <p><strong>3. 内容规范</strong>：用户不得利用本服务从事违法违规活动，不得发送骚扰、侮辱性言论。</p>
                <p><strong>4. 隐私保护</strong>：我们承诺不公开用户的对话记录，仅用于提供对话服务。</p>
                <p><strong>5. 免责声明</strong>：AI 生成的内容仅供参考，不构成任何职业建议或承诺。</p>
                <p><strong>6. 协议变更</strong>：本服务保留随时修改协议的权利，修改后将在页面公示。</p>
              </div>
              <button onClick={() => setShowAgreement(false)} style={{ marginTop: 16, width: '100%', padding: 10, background: '#2b5cff', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>我已阅读</button>
            </div>
          </div>
        )}
      </div>
    );
  }

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
          {identityMode === 'guest' && (
            <span className="guest-quota-tag">{sessions.length}/{limits.maxSessions}</span>
          )}
        </div>
        <button className="new-chat-btn" onClick={newSession}>+ 新对话</button>
        {identityMode === 'guest' && (
          <div className="guest-quota-tip">访客模式 · 每会话限 {limits.maxQuestionsPerSession} 次提问 · 会话不可删除</div>
        )}
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
              {identityMode === 'guest' && (s.askedCount || 0) > 0 && (
                <span className="session-used-tag">已提问</span>
              )}
              {identityMode === 'user' && sessions.length > 1 && (
                <button
                  className="session-delete"
                  onClick={(e) => deleteSession(s.id, e)}
                  title="删除会话"
                >✕</button>
              )}
            </div>
          ))}
        </div>
        <div className="sidebar-drag-handle" onMouseDown={onDragStart} />
      </div>

      {/* 主聊天区 */}
      <div className="chat-page">
        <div className="chat-header">
          <div className="header-left">
            <button className="header-icon-btn menu-btn" onClick={() => setSidebarOpen(!sidebarOpen)} title="会话列表">
              <MenuIcon />
            </button>
            <div className="header-brand">
              <BrandMark size={36} />
              <div className="header-titles">
                <div className="brand-line">
                  <span className="brand-name">个人AI助手</span>
                  <span className="brand-status"><i />在线</span>
                </div>
                <div className="brand-sub">
                  {profile.name} · {profile.title} · {profile.city} · {profile.experienceCount} 段经历 / {profile.projectCount} 个项目
                </div>
              </div>
            </div>
          </div>

          <div className="header-actions">
            <button className="header-icon-btn" onClick={() => setDark(!dark)} title={dark ? '切换到浅色' : '切换到深色'}>
              {dark ? <SunIcon /> : <MoonIcon />}
            </button>
            {/* 用户头像 */}
            <div ref={userPanelRef} className="avatar-wrap">
              <div className="avatar-btn" onClick={() => setUserPanelOpen(!userPanelOpen)} title="个人中心">
                {visitorUser ? AVATARS[parseInt(visitorUser.avatar || '0')] || '👤' : '👤'}
              </div>
              {userPanelOpen && (
                <div className="user-panel">
                  <div className="user-panel-head">
                    <div className="user-panel-avatar">
                      {visitorUser ? AVATARS[parseInt(visitorUser.avatar || '0')] || '👤' : '👤'}
                    </div>
                    <div className="user-panel-name">{visitorUser?.nickname || '游客模式'}</div>
                    {visitorUser && <div className="user-panel-account">@{visitorUser.username}</div>}
                    {!visitorUser && (
                      <div className="user-panel-account">
                        会话 {sessions.length}/{limits.maxSessions} · 每会话 {limits.maxQuestionsPerSession} 次提问
                      </div>
                    )}
                  </div>
                  {visitorUser ? (
                    <button className="user-panel-btn danger" onClick={logout}>退出登录</button>
                  ) : (
                    <button className="user-panel-btn primary" onClick={openAuthPage}>登录 / 注册</button>
                  )}
                </div>
              )}
            </div>
          </div>
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
                    {m.error && !m.needLogin && (
                      <div style={{ marginTop: 8 }}>
                        <button
                          onClick={() => { send(m.failedQuery || '', m.id); }}
                          style={{ padding: '4px 12px', fontSize: 12, cursor: 'pointer', borderRadius: 6, border: '1px solid #d9d9d9', background: '#fff' }}
                        >
                          重试
                        </button>
                      </div>
                    )}
                    {m.needLogin && (
                      <div style={{ marginTop: 10 }}>
                        <button
                          onClick={openAuthPage}
                          style={{ padding: '8px 20px', fontSize: 13, cursor: 'pointer', borderRadius: 8, border: 'none', background: '#2b5cff', color: '#fff' }}
                        >
                          登录后继续对话 →
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
          {identityMode === 'guest' && guestQuotaUsed ? (
            <div className="guest-limit-bar">
              <span>访客每个会话仅限 {limits.maxQuestionsPerSession} 次提问，登录后可不限次对话</span>
              <button onClick={openAuthPage}>登录 / 注册</button>
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>

      {/* 访客额度用尽提示 */}
      {loginPrompt && (
        <div className="limit-modal-mask" onClick={() => setLoginPrompt(null)}>
          <div className="limit-modal" onClick={e => e.stopPropagation()}>
            <h3>{loginPrompt === 'session' ? '访客会话已达上限' : '该会话的提问次数已用完'}</h3>
            <p>
              {loginPrompt === 'session'
                ? `访客最多创建 ${limits.maxSessions} 个会话，登录后不限会话数量。`
                : `访客每个会话只能提问 ${limits.maxQuestionsPerSession} 次，登录后可继续对话。`}
            </p>
            <div className="limit-modal-actions">
              <button className="ghost" onClick={() => setLoginPrompt(null)}>稍后再说</button>
              <button className="primary" onClick={openAuthPage}>登录 / 注册</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
