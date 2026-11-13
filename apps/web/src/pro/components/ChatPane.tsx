import { useEffect, useRef, useState } from 'react';
import ChatMarkdown from '../../components/chat/ChatMarkdown';
import { SendIcon } from '../../components/ProIcons';
import type { ProArtifact, ProAttachment, ProMessage, ProSession } from '../types';
import ArtifactCard from './ArtifactCard';
import ToolGroup from './ToolGroup';
import PermissionCard from './PermissionCard';
import ChangeCard from './ChangeCard';

const SAMPLES = [
  '看看我的项目结构，指出可以优化的地方',
  '画一张深色高级感的封面图，主题是「AI 助手专业版」',
  '做一个产品落地页的设计稿，输出完整 HTML',
  '把这份需求整理成 Markdown，再导出成 Word',
];

/** 模型卡壳时也别让界面死气沉沉：工具执行中/推理中/单纯等待，各自给一句话 + 已等待秒数 */
function StreamHint({ msg }: { msg: ProMessage }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!msg.streaming) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [msg.streaming]);

  if (!msg.streaming) return null;

  const running = msg.tools?.find((t) => t.status === 'running');
  const idleSec = Math.max(0, Math.round((now - (msg.lastActivityAt || now)) / 1000));

  if (running) {
    return <div className="stream-hint">⚙ 正在执行：{running.label || running.name}</div>;
  }
  if (msg.thinkingChars) {
    return (
      <div className="stream-hint thinking">
        <span className="thinking-dot" />
        模型思考中（已输出 {msg.thinkingChars} 字思考，正文马上开始）
      </div>
    );
  }
  // 正文正在持续输出时不用打扰；静默超过 3 秒才提示
  if (msg.content && idleSec < 3) return null;
  return (
    <div className="stream-hint">
      ⏳ {msg.content ? `等待模型继续输出（已 ${idleSec}s）` : `模型正在准备回答（已 ${idleSec}s）`}
    </div>
  );
}

export default function ChatPane({
  session,
  messages,
  busy,
  model,
  permissionMode,
  onSend,
  onStop,
  onDecide,
  onUpload,
  onRollback,
  onOpenArtifact,
  searchEnabled,
  searchOn,
  onToggleSearch,
}: {
  session: ProSession | null;
  messages: ProMessage[];
  busy: boolean;
  model: string;
  permissionMode: 'readonly' | 'standard';
  onSend: (text: string, attachments: ProAttachment[]) => void;
  onStop: () => void;
  onDecide: (decision: 'once' | 'session' | 'deny') => void;
  onUpload: (file: File) => Promise<ProAttachment>;
  onRollback: (changeId: string) => Promise<void>;
  onOpenArtifact: (artifact: ProArtifact) => void;
  /** 设置里的联网总开关 */
  searchEnabled: boolean;
  /** 本轮是否联网（输入区小地球） */
  searchOn: boolean;
  onToggleSearch: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<{ id: string; name: string; attachment: ProAttachment }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** 是否贴底跟随。用户一旦上滑就置 false，不再抢滚动条 */
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  // 贴底跟随：只有用户自己在底部时才跟着新内容滚；用户上滑阅读时不打扰，改为露出"回到最新"按钮
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (!stickRef.current) {
      setShowJump(true);
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    // 新会话/切换会话时重置为贴底
    stickRef.current = true;
    setShowJump(false);
    el.scrollTop = el.scrollHeight;
  }, [session?.id]);

  const onListScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distance < 48;
    stickRef.current = atBottom;
    setShowJump(!atBottom);
  };

  const jumpToBottom = () => {
    const el = listRef.current;
    if (!el) return;
    stickRef.current = true;
    setShowJump(false);
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(200, Math.max(44, el.scrollHeight))}px`;
  }, [draft]);

  const submit = () => {
    const text = draft.trim();
    if (!text || busy || uploading) return;
    onSend(text, pending.map((p) => p.attachment));
    setDraft('');
    setPending([]);
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setUploadError('');
    setUploading(true);
    try {
      const attachment = await onUpload(file);
      setPending((prev) => [...prev, { id: attachment.path + attachment.name, name: attachment.name, attachment }]);
    } catch (err: any) {
      setUploadError(err?.message || '上传失败');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="pro-chat">
      <div className="pro-chat-head">
        <div className="pro-chat-title">{session?.title || '新会话'}</div>
        <div className="pro-chat-meta">
          <span className={`pro-chip${permissionMode === 'readonly' ? ' warn' : ''}`}>
            {permissionMode === 'readonly' ? '只读模式' : '标准模式'}
          </span>
          <span className="pro-chip quiet">{model}</span>
        </div>
      </div>

      <div className="pro-msg-wrap">
        <div className="pro-msg-list" ref={listRef} onScroll={onListScroll}>
        {!session || messages.length === 0 ? (
          <div className="pro-empty">
            <div className="pro-empty-badge">PRO</div>
            <h2>今天想做点什么？</h2>
            <p>读代码、改文件、分析图片、写文档——直接说需求，我会真的动手，并在改文件前先征得你同意。</p>
            <div className="pro-samples">
              {SAMPLES.map((s) => (
                <button key={s} type="button" className="pro-sample" onClick={() => setDraft(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`message-row ${msg.role}`}>
              {msg.role === 'user' ? (
                <>
                  <div className="bubble user">{msg.content}</div>
                  {msg.attachments?.length ? (
                    <div className="msg-attachments">
                      {msg.attachments.map((a) => (
                        <span key={a.path} className="msg-attachment">
                          {a.name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {msg.searchEnabled === false ? <span className="search-chip off small">🌐 本轮未联网</span> : null}
                </>
              ) : (
                <div className="pro-assistant">
                  {msg.tools?.length ? <ToolGroup tools={msg.tools} streaming={msg.streaming} /> : null}

                  {msg.changes?.length ? (
                    <div className="change-stack">
                      {msg.changes.map((change) => (
                        <ChangeCard key={change.id} change={change} onRollback={onRollback} />
                      ))}
                    </div>
                  ) : null}

                  {msg.artifacts?.length ? (
                    <div className="artifact-stack">
                      {msg.artifacts.map((artifact) => (
                        <ArtifactCard key={artifact.id} artifact={artifact} onOpen={onOpenArtifact} />
                      ))}
                    </div>
                  ) : null}

                  {msg.search && (msg.search.count > 0 || msg.search.fetches > 0) ? (
                    <div className="search-trace">
                      <span className="search-chip">
                        🌐 已联网搜索 {msg.search.count} 次
                        {msg.search.fetches ? ` · 抓取 ${msg.search.fetches} 个网页` : ''}
                      </span>
                      {msg.search.links.length ? (
                        <div className="search-links">
                          {msg.search.links.slice(0, 6).map((link, index) => (
                            <a key={`${link.url}-${index}`} href={link.url} target="_blank" rel="noreferrer" title={link.url}>
                              {link.title || link.url}
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {msg.search?.enabled === false && msg.role === 'assistant' ? (
                    <div className="search-trace off">
                      <span className="search-chip off">🌐 本轮未联网</span>
                    </div>
                  ) : null}

                  {msg.permission ? (
                    <PermissionCard
                      request={msg.permission}
                      onDecide={(decision) => onDecide(decision)}
                      disabled={msg.permission.status !== 'pending'}
                    />
                  ) : null}

                  {msg.content ? (
                    <div className={`bubble assistant${msg.error ? ' bubble-error' : ''}`}>
                      <ChatMarkdown content={msg.content} />
                    </div>
                  ) : msg.streaming ? (
                    <div className="bubble assistant typing">
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                    </div>
                  ) : null}

                  <StreamHint msg={msg} />

                  {msg.usage ? (
                    <div className="msg-usage">
                      约 {msg.usage.estTokens} tokens · {msg.usage.model}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ))
        )}
        </div>

        {showJump ? (
          <button type="button" className="pro-jump-bottom" onClick={jumpToBottom} title="回到最新内容">
            ↓ 回到最新
          </button>
        ) : null}
      </div>

      <div className="pro-composer">
        {pending.length ? (
          <div className="composer-attachments">
            {pending.map((p) => (
              <span key={p.id} className="composer-attachment">
                {p.name}
                <button
                  type="button"
                  onClick={() => setPending((prev) => prev.filter((x) => x.id !== p.id))}
                  aria-label="移除附件"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {uploadError ? <div className="composer-error">{uploadError}</div> : null}

        <div className="composer-box">
          <textarea
            ref={textareaRef}
            className="composer-input"
            placeholder={permissionMode === 'readonly' ? '只读模式下不会改动任何文件…' : '描述你的需求，Enter 发送，Shift+Enter 换行'}
            value={draft}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="composer-tools">
            <button
              type="button"
              className={`composer-icon${searchOn && searchEnabled ? ' active' : ''}`}
              title={
                !searchEnabled
                  ? '联网已总开关关闭（去设置里打开）'
                  : searchOn
                    ? '本轮允许联网，点击关闭'
                    : '本轮不联网，点击开启'
              }
              onClick={onToggleSearch}
              disabled={!searchEnabled || busy}
            >
              🌐
            </button>
            <button
              type="button"
              className="composer-icon"
              title="上传图片"
              onClick={() => fileRef.current?.click()}
              disabled={uploading || busy}
            >
              {uploading ? '…' : '＋'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
            <div className="composer-hint">{model}</div>
            {busy ? (
              <button type="button" className="composer-stop" onClick={onStop}>
                停止
              </button>
            ) : (
              <button type="button" className="composer-send" onClick={submit} disabled={!draft.trim() || uploading}>
                <SendIcon size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
