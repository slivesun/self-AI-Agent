import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../db.js';
import { getPublicProfile } from '../agent.js';
import { streamChatWithLLM } from '../llm.js';
import { parseCitations } from '../utils.js';
import type { PublicProfile } from '@resume-agent/shared';

const router = Router();

// 临时存储 runId → 待回答的问题（SSE 连接时取出），带过期清理
const pendingRuns = new Map<string, { sessionId: string; content: string; model?: string; ts: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingRuns) {
    if (now - v.ts > 120000) pendingRuns.delete(k);
  }
}, 60000);

// 初始化会话
router.post('/c/:slug/session', (req, res) => {
  const link = db.prepare('SELECT * FROM share_links WHERE slug = ? AND enabled = 1').get(req.params.slug) as any;
  if (!link) return res.status(404).json({ ok: false, error: '链接不存在或已失效' });
  if (link.expires_at && new Date(link.expires_at) < new Date()) return res.status(410).json({ ok: false, error: '链接已过期' });
  if (link.require_code && link.code && req.body.code !== link.code) return res.status(403).json({ ok: false, error: '访问码不正确' });

  const visitorId = req.body.visitorId || crypto.randomUUID();
  const wantNew = req.body.newSession === true;

  let sessionId: string;
  if (!wantNew && req.body.visitorId) {
    const existing = db.prepare('SELECT id FROM visitor_sessions WHERE visitor_id = ? ORDER BY created_at DESC LIMIT 1').get(visitorId) as any;
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
    skills: (profile.skills || []).map(g => ({ group: g.group, items: (g.items || []).map(i => i.name) }))
  } : { name: '', title: '', city: '', summary: '', links: [], experienceCount: 0, projectCount: 0, skills: [] };

  res.json({ ok: true, data: { visitorId, sessionId, profilePublic: pub } });
});

// 列出访客会话
router.get('/c/:slug/sessions', (req, res) => {
  const visitorId = req.query.visitorId as string;
  if (!visitorId) return res.json({ ok: true, data: { sessions: [] } });
  const rows = db.prepare(`
    SELECT s.id, s.created_at,
      (SELECT content FROM visitor_messages WHERE session_id = s.id AND role = 'user' ORDER BY created_at ASC LIMIT 1) as first_msg,
      (SELECT content FROM visitor_messages WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1) as last_msg,
      (SELECT COUNT(*) FROM visitor_messages WHERE session_id = s.id) as msg_count
    FROM visitor_sessions s WHERE s.visitor_id = ? ORDER BY s.created_at DESC
  `).all(visitorId) as any[];
  res.json({ ok: true, data: { sessions: rows.map(r => ({
    id: r.id, createdAt: r.created_at,
    title: (r.first_msg || '新会话').slice(0, 20), lastMessage: (r.last_msg || '').slice(0, 40), messageCount: r.msg_count,
  })) }});
});

// 获取会话历史
router.get('/c/:slug/sessions/:sessionId/messages', (req, res) => {
  const rows = db.prepare('SELECT role, content FROM visitor_messages WHERE session_id = ? ORDER BY created_at ASC').all(req.params.sessionId) as any[];
  res.json({ ok: true, data: { messages: rows.map(r => ({ role: r.role, content: r.content })) } });
});

// 删除会话
router.delete('/c/:slug/sessions/:sessionId', (req, res) => {
  db.prepare('DELETE FROM visitor_messages WHERE session_id = ?').run(req.params.sessionId);
  db.prepare('DELETE FROM visitor_sessions WHERE id = ?').run(req.params.sessionId);
  res.json({ ok: true });
});

// 发送消息
router.post('/c/:slug/messages', (req, res) => {
  const { sessionId, content, model } = req.body;
  if (!sessionId || !content) return res.status(400).json({ ok: false, error: '缺少参数' });
  const msgCount = (db.prepare("SELECT COUNT(*) as c FROM visitor_messages WHERE session_id = ? AND date(created_at) = date('now')").get(sessionId) as any).c;
  if (msgCount >= 30) return res.status(429).json({ ok: false, error: '今日对话已达上限，明天再来聊聊吧' });
  const runId = crypto.randomUUID();
  db.prepare('INSERT INTO visitor_messages (id, session_id, role, content, citations, answered) VALUES (?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), sessionId, 'user', content, '[]', 1);
  pendingRuns.set(runId, { sessionId, content, model, ts: Date.now() });
  res.json({ ok: true, data: { runId } });
});

// SSE 流式回答
router.get('/runs/:id/events', async (req, res) => {
  const runId = req.params.id;
  const sessionId = req.query.sessionId as string;
  if (!sessionId) return res.status(400).end();
  const pending = pendingRuns.get(runId);
  if (!pending) return res.status(404).end();
  pendingRuns.delete(runId);

  const historyRows = db.prepare(
    "SELECT role, content FROM visitor_messages WHERE session_id = ? AND role IN ('user','assistant') ORDER BY created_at DESC LIMIT 10"
  ).all(sessionId) as any[];
  const history = historyRows.reverse().map(r => ({ role: r.role, content: r.content }));

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  let seq = 0;
  res.write(`id: ${seq++}\nevent: start\ndata: {}\n\n`);

  let fullAnswer = '';
  try {
    await streamChatWithLLM(pending.content, history, (token) => {
      fullAnswer += token;
      res.write(`id: ${seq++}\nevent: delta\ndata: ${JSON.stringify({ text: token })}\n\n`);
    }, pending.model);
  } catch (e: any) {
    console.error('LLM 调用失败:', e.message);
    fullAnswer = '抱歉，暂时无法回答这个问题，请稍后再试。';
    res.write(`id: ${seq++}\nevent: delta\ndata: ${JSON.stringify({ text: fullAnswer })}\n\n`);
  }
  if (!fullAnswer.trim()) {
    fullAnswer = '这个问题我不太确定，建议直接问我本人。';
    res.write(`id: ${seq++}\nevent: delta\ndata: ${JSON.stringify({ text: fullAnswer })}\n\n`);
  }

  const { clean, citations } = parseCitations(fullAnswer);
  db.prepare('INSERT INTO visitor_messages (id, session_id, role, content, citations, answered) VALUES (?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), sessionId, 'assistant', clean, JSON.stringify(citations), 1);
  res.write(`id: ${seq++}\nevent: citations\ndata: ${JSON.stringify({ citations })}\n\n`);
  res.write(`id: ${seq++}\nevent: done\ndata: {}\n\n`);
  res.end();
});

export default router;
