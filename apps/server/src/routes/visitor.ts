import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../db.js';
import { getPublicProfile } from '../agent.js';
import { streamChatWithLLM, normalizeModel } from '../llm.js';
import { parseCitations } from '../utils.js';
import { verifyToken, signStreamToken, verifyStreamToken } from '../auth.js';
import { rateLimit } from '../rateLimit.js';
import type { PublicProfile } from '@resume-agent/shared';

const router = Router();

// 访客额度（仅在未登录时生效）
const GUEST_MAX_SESSIONS = 5;
const GUEST_MAX_QUESTIONS_PER_SESSION = 1;
const MAX_MESSAGE_LENGTH = 2000;

// 每个会话题目上限（当日）
const DAILY_MESSAGES_PER_SESSION = 30;
// 注册账号跨会话的日答题总量上限（防止注册绕过访客限制刷额度）
const DAILY_MESSAGES_PER_USER = Number(process.env.DAILY_MESSAGES_PER_USER || 200);

// 临时存储 runId → 待回答的问题（SSE 连接时取出），带过期清理
const pendingRuns = new Map<string, { sessionId: string; userMsgId: string; content: string; model?: string; ts: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingRuns) {
    if (now - v.ts > 120000) pendingRuns.delete(k);
  }
}, 30000);

// 提问限流：同一 IP 每分钟最多 10 次，避免脚本刷额度
const messageLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: '发送过于频繁，请稍后再试' });
const sessionLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, message: '操作过于频繁，请稍后再试' });

// 解析当前身份：已登录返回账号 id（会话归属该账号），未登录由调用方取匿名 visitorId
function getIdentity(req: any): { loggedIn: boolean; ownerId: string } {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return { loggedIn: false, ownerId: '' };
  const payload = verifyToken(auth.slice(7));
  if (!payload || payload.role !== 'visitor') return { loggedIn: false, ownerId: '' };
  const row = db.prepare('SELECT id FROM visitor_users WHERE id = ?').get(payload.sub as any) as any;
  if (!row) return { loggedIn: false, ownerId: '' };
  return { loggedIn: true, ownerId: String(row.id) };
}

// 校验会话归属，防止跨账号/跨访客操作
function sessionOwner(sessionId: string): string | null {
  const row = db.prepare('SELECT visitor_id FROM visitor_sessions WHERE id = ?').get(sessionId) as any;
  return row ? String(row.visitor_id) : null;
}

/** 未登录时必须由客户端带上自己的匿名 id，且必须与会话归属一致 */
function checkGuestOwnership(req: any, owner: string): boolean {
  const visitorId = String((req.body?.visitorId ?? req.query?.visitorId ?? '') || '');
  return !!visitorId && visitorId === owner;
}

function conflict(): { ok: false; code: string; error: string } {
  return { ok: false, code: 'SESSION_NOT_OWNED', error: '该会话不属于当前访客' };
}

// 默认对话链接：桌面端启动后据此决定主窗口加载哪个 /c/{slug}，
// 避免把 slug 写死在客户端（换库/重建数据后 slug 会变）。
router.get('/default-link', (req, res) => {
  const link = db.prepare('SELECT slug, require_code FROM share_links WHERE enabled = 1 ORDER BY created_at ASC LIMIT 1').get() as any;
  if (!link) return res.status(404).json({ ok: false, error: '还没有可用的对话链接' });
  res.json({ ok: true, data: { slug: link.slug, requireCode: !!link.require_code } });
});

// 初始化会话
router.post('/c/:slug/session', sessionLimiter, (req, res) => {
  const link = db.prepare('SELECT * FROM share_links WHERE slug = ? AND enabled = 1').get(req.params.slug) as any;
  if (!link) return res.status(404).json({ ok: false, error: '链接不存在或已失效' });
  if (link.expires_at && new Date(link.expires_at) < new Date()) return res.status(410).json({ ok: false, error: '链接已过期' });
  if (link.require_code && link.code && req.body.code !== link.code) return res.status(403).json({ ok: false, error: '访问码不正确' });

  const identity = getIdentity(req);
  // 已登录时强制以账号 id 作为会话归属，忽略前端传入的 visitorId，避免不同身份串会话
  const visitorId = identity.loggedIn
    ? identity.ownerId
    : String(req.body.visitorId || crypto.randomUUID()).slice(0, 64);
  const wantNew = req.body.newSession === true;

  const sessionCount = (db.prepare('SELECT COUNT(*) as c FROM visitor_sessions WHERE visitor_id = ?').get(visitorId) as any).c;

  // 未登录用户新建会话限流：最多 5 个
  if (!identity.loggedIn && wantNew && sessionCount >= GUEST_MAX_SESSIONS) {
    return res.status(403).json({
      ok: false,
      code: 'GUEST_SESSION_LIMIT',
      error: `未登录访客最多创建 ${GUEST_MAX_SESSIONS} 个会话，注册或登录后可继续使用`,
    });
  }

  let sessionId: string;
  if (!wantNew) {
    // 取“最近活跃”的会话：优先有消息记录的会话（按最后一条消息时间），没有记录时再取最近创建的
    const existing = db.prepare(`
      SELECT s.id AS id,
        COALESCE((SELECT MAX(m.created_at) FROM visitor_messages m WHERE m.session_id = s.id), s.created_at) AS last_at,
        (SELECT COUNT(*) FROM visitor_messages m WHERE m.session_id = s.id) AS msg_count
      FROM visitor_sessions s
      WHERE s.visitor_id = ?
      ORDER BY (CASE WHEN msg_count > 0 THEN 0 ELSE 1 END), last_at DESC, s.created_at DESC, s.rowid DESC
      LIMIT 1
    `).get(visitorId) as any;
    if (existing) {
      sessionId = existing.id;
    } else {
      sessionId = crypto.randomUUID();
      const ipHash = crypto.createHash('sha256').update(req.ip || '').digest('hex').slice(0, 16);
      db.prepare('INSERT INTO visitor_sessions (id, visitor_id, share_link_id, ip_hash, ua) VALUES (?, ?, ?, ?, ?)')
        .run(sessionId, visitorId, link.id, ipHash, (req.headers['user-agent'] || '').slice(0, 200));
    }
  } else {
    sessionId = crypto.randomUUID();
    const ipHash = crypto.createHash('sha256').update(req.ip || '').digest('hex').slice(0, 16);
    db.prepare('INSERT INTO visitor_sessions (id, visitor_id, share_link_id, ip_hash, ua) VALUES (?, ?, ?, ?, ?)')
      .run(sessionId, visitorId, link.id, ipHash, (req.headers['user-agent'] || '').slice(0, 200));
  }

  const profile = getPublicProfile();
  const pub: PublicProfile = profile ? {
    name: profile.basics?.name || '', title: profile.basics?.title || '', city: profile.basics?.city || '',
    summary: profile.summary || '', links: profile.basics?.links || [],
    experienceCount: (profile.experiences || []).length, projectCount: (profile.projects || []).length,
    skills: (profile.skills || []).map((g: any) => ({ group: g.group, items: (g.items || []).map((i: any) => i.name) }))
  } : { name: '', title: '', city: '', summary: '', links: [], experienceCount: 0, projectCount: 0, skills: [] };

  res.json({
    ok: true,
    data: {
      visitorId,
      sessionId,
      loggedIn: identity.loggedIn,
      limits: { maxSessions: GUEST_MAX_SESSIONS, maxQuestionsPerSession: GUEST_MAX_QUESTIONS_PER_SESSION },
      profilePublic: pub,
    },
  });
});

// 列出当前身份的会话（已登录按账号 id，未登录按匿名 visitorId）
router.get('/c/:slug/sessions', (req, res) => {
  const identity = getIdentity(req);
  const visitorId = identity.loggedIn ? identity.ownerId : String(req.query.visitorId || '');
  if (!visitorId) return res.json({ ok: true, data: { sessions: [] } });
  const rows = db.prepare(`
    SELECT s.id, s.created_at,
      (SELECT content FROM visitor_messages WHERE session_id = s.id AND role = 'user' ORDER BY created_at ASC, rowid ASC LIMIT 1) as first_msg,
      (SELECT content FROM visitor_messages WHERE session_id = s.id ORDER BY created_at DESC, rowid DESC LIMIT 1) as last_msg,
      (SELECT MAX(created_at) FROM visitor_messages WHERE session_id = s.id) as last_msg_at,
      (SELECT COUNT(*) FROM visitor_messages WHERE session_id = s.id) as msg_count,
      (SELECT COUNT(*) FROM visitor_messages WHERE session_id = s.id AND role = 'user' AND answered = 1) as asked_count
    FROM visitor_sessions s
    WHERE s.visitor_id = ?
    ORDER BY (CASE WHEN (SELECT COUNT(*) FROM visitor_messages m WHERE m.session_id = s.id) > 0 THEN 0 ELSE 1 END),
             COALESCE(last_msg_at, s.created_at) DESC, s.rowid DESC
  `).all(visitorId) as any[];
  res.json({ ok: true, data: { sessions: rows.map(r => ({
    id: r.id, createdAt: r.created_at,
    title: (r.first_msg || '新会话').slice(0, 20), lastMessage: (r.last_msg || '').slice(0, 40),
    messageCount: r.msg_count, askedCount: r.asked_count,
  })) }});
});

// 获取会话历史（已登录只能读自己账号下的会话；访客必须带自己的匿名 id）
router.get('/c/:slug/sessions/:sessionId/messages', (req, res) => {
  const identity = getIdentity(req);
  const owner = sessionOwner(req.params.sessionId);
  if (owner === null) return res.status(404).json({ ok: false, error: '会话不存在' });
  if (identity.loggedIn) {
    if (owner !== identity.ownerId) return res.status(403).json({ ok: false, error: '无权访问该会话' });
  } else if (!checkGuestOwnership(req, owner)) {
    return res.status(403).json(conflict());
  }
  const rows = db.prepare('SELECT role, content, answered FROM visitor_messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC').all(req.params.sessionId) as any[];
  const askedCount = (db.prepare("SELECT COUNT(*) as c FROM visitor_messages WHERE session_id = ? AND role = 'user' AND answered = 1").get(req.params.sessionId) as any).c;
  res.json({ ok: true, data: { messages: rows.map(r => ({ role: r.role, content: r.content })), askedCount } });
});

// 删除会话（仅登录用户可删除自己账号下的会话；访客会话不可删除）
router.delete('/c/:slug/sessions/:sessionId', (req, res) => {
  const identity = getIdentity(req);
  if (!identity.loggedIn) {
    return res.status(403).json({ ok: false, code: 'GUEST_DELETE_DISABLED', error: '访客会话不可删除，登录后可管理自己的会话' });
  }
  const owner = sessionOwner(req.params.sessionId);
  if (owner === null) return res.json({ ok: true });
  if (owner !== identity.ownerId) {
    return res.status(403).json({ ok: false, error: '无权删除该会话' });
  }
  db.prepare('DELETE FROM visitor_messages WHERE session_id = ?').run(req.params.sessionId);
  db.prepare('DELETE FROM visitor_sessions WHERE id = ?').run(req.params.sessionId);
  res.json({ ok: true });
});

// 发送消息
router.post('/c/:slug/messages', messageLimiter, (req, res) => {
  const { sessionId, content, model } = req.body || {};
  if (typeof sessionId !== 'string' || !sessionId) return res.status(400).json({ ok: false, error: '缺少会话 id' });
  if (typeof content !== 'string' || !content.trim()) return res.status(400).json({ ok: false, error: '请输入问题' });
  if (content.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ ok: false, error: `问题过长，最多 ${MAX_MESSAGE_LENGTH} 字` });
  }

  const owner = sessionOwner(sessionId);
  if (owner === null) return res.status(404).json({ ok: false, code: 'SESSION_NOT_FOUND', error: '会话不存在，请刷新后重试' });

  const identity = getIdentity(req);

  // 会话归属校验：已登录只能问自己账号的会话；未登录必须带自己的匿名 id
  if (identity.loggedIn) {
    if (owner !== identity.ownerId) return res.status(403).json({ ok: false, code: 'SESSION_NOT_OWNED', error: '该会话不属于当前账号' });
  } else if (!checkGuestOwnership(req, owner)) {
    return res.status(403).json(conflict());
  }

  // 未登录限流：每个会话只能提 1 个问题
  if (!identity.loggedIn) {
    const answeredCount = (db.prepare("SELECT COUNT(*) as c FROM visitor_messages WHERE session_id = ? AND role = 'user' AND answered = 1").get(sessionId) as any).c;
    if (answeredCount >= GUEST_MAX_QUESTIONS_PER_SESSION) {
      return res.status(403).json({
        ok: false,
        code: 'GUEST_QUESTION_LIMIT',
        error: '未登录访客每个会话只能提问 1 次，注册或登录后可继续对话',
      });
    }
  }

  // 注册账号：跨会话日总量上限
  if (identity.loggedIn) {
    const todayCount = (db.prepare(`
      SELECT COUNT(*) as c FROM visitor_messages m
      JOIN visitor_sessions s ON s.id = m.session_id
      WHERE s.visitor_id = ? AND m.role = 'user' AND date(m.created_at) = date('now')
    `).get(identity.ownerId) as any).c;
    if (todayCount >= DAILY_MESSAGES_PER_USER) {
      return res.status(429).json({
        ok: false,
        code: 'DAILY_QUOTA_EXCEEDED',
        error: `今日提问次数已达上限（${DAILY_MESSAGES_PER_USER} 次），明天再来吧`,
      });
    }
  }

  const msgCount = (db.prepare("SELECT COUNT(*) as c FROM visitor_messages WHERE session_id = ? AND date(created_at) = date('now')").get(sessionId) as any).c;
  if (msgCount >= DAILY_MESSAGES_PER_SESSION) return res.status(429).json({ ok: false, error: '今日对话已达上限，明天再来聊聊吧' });

  const runId = crypto.randomUUID();
  const userMsgId = crypto.randomUUID();
  db.prepare('INSERT INTO visitor_messages (id, session_id, role, content, citations, answered) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userMsgId, sessionId, 'user', content.trim(), '[]', 1);
  pendingRuns.set(runId, { sessionId, userMsgId, content: content.trim(), model: normalizeModel(model), ts: Date.now() });
  res.json({ ok: true, data: { runId, streamToken: signStreamToken(runId, sessionId) } });
});

// SSE 流式回答：需携带发送消息时返回的短时 streamToken（绑定 runId + sessionId）
router.get('/runs/:id/events', async (req, res) => {
  const runId = req.params.id;
  const token = String(req.query.token || '');
  const proof = verifyStreamToken(token);
  if (!proof || proof.runId !== runId) {
    return res.status(401).json({ ok: false, error: '流式凭证无效或已过期' });
  }

  const pending = pendingRuns.get(runId);
  if (!pending || pending.sessionId !== proof.sessionId) return res.status(404).end();
  pendingRuns.delete(runId);

  const historyRows = db.prepare(
    "SELECT role, content FROM visitor_messages WHERE session_id = ? AND role IN ('user','assistant') ORDER BY created_at DESC, rowid DESC LIMIT 10"
  ).all(pending.sessionId) as any[];
  const history = historyRows.reverse().map(r => ({ role: r.role, content: r.content }));

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  let seq = 0;
  res.write(`id: ${seq++}\nevent: start\ndata: {}\n\n`);

  // 客户端中途断开（停止/刷新）时：中断上游 LLM 请求，把该问题标记为未回答（不占额度）
  let completed = false;
  let aborted = false;
  const controller = new AbortController();

  res.on('close', () => {
    if (completed) return;
    aborted = true;
    controller.abort();
    db.prepare('UPDATE visitor_messages SET answered = 0 WHERE id = ?').run(pending.userMsgId);
  });

  let fullAnswer = '';
  const writeEvent = (event: string, data: any) => {
    if (aborted) return;
    try { res.write(`id: ${seq++}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { aborted = true; }
  };

  try {
    await streamChatWithLLM(pending.content, history, (token) => {
      fullAnswer += token;
      writeEvent('delta', { text: token });
    }, pending.model, controller.signal);
  } catch (e: any) {
    if (!aborted) {
      console.error('LLM 调用失败:', e?.message || e);
      fullAnswer = '抱歉，暂时无法回答这个问题，请稍后再试。';
      writeEvent('delta', { text: fullAnswer });
    }
  }

  // 客户端已断开：不落库助手回答，保持"未回答"状态让用户可以重试
  if (aborted) {
    try { res.end(); } catch {}
    return;
  }

  if (!fullAnswer.trim()) {
    fullAnswer = '这个问题我不太确定，建议直接问我本人。';
    writeEvent('delta', { text: fullAnswer });
  }

  const { clean, citations } = parseCitations(fullAnswer);
  db.prepare('INSERT INTO visitor_messages (id, session_id, role, content, citations, answered) VALUES (?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), pending.sessionId, 'assistant', clean, JSON.stringify(citations), 1);

  // 回答没有引用任何知识文档、且话术上表示"资料里没有" → 记进未答问题，供后台补内容
  recordUnansweredIfNeeded(pending.content, clean, citations.length);

  writeEvent('citations', { citations });
  writeEvent('done', {});
  completed = true;
  res.end();
});

/** 未答问题收集：按问题文本去重累加，后台「会话分析」展示 */
function recordUnansweredIfNeeded(question: string, answer: string, citationCount: number) {
  if (citationCount > 0) return;
  if (!/(资料(里|中)?(没有|未|不)|不清楚|不太确定|无法回答|建议直接(问|联系)|不方便代答)/.test(answer)) return;
  const q = question.trim().slice(0, 120);
  if (!q) return;
  try {
    const existing = db.prepare('SELECT id FROM unanswered_questions WHERE question = ?').get(q) as { id: string } | undefined;
    if (existing) {
      db.prepare("UPDATE unanswered_questions SET hit_count = hit_count + 1, last_seen = datetime('now') WHERE id = ?").run(existing.id);
    } else {
      db.prepare('INSERT INTO unanswered_questions (id, question) VALUES (?, ?)').run(crypto.randomUUID(), q);
    }
  } catch (e) {
    console.warn('[visitor] 未答问题记录失败:', (e as any)?.message || e);
  }
}

export default router;
