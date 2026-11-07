import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initDb, db } from './db.js';
import { signToken, requireAuth } from './auth.js';
import { generateAnswer, getPublicProfile, recordUnanswered } from './agent.js';
import { parsePdf, parseDocx, extractProfileFromText, parseResumeWithLLM } from './parse.js';
import type { Profile, QAPair, Persona, ShareLink, PublicProfile } from '@resume-agent/shared';

initDb();

const app = express();
const PORT = process.env.PORT || 3001;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3001'],
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));

// ===== Auth =====
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const hash = crypto.createHash('sha256').update(password || '').digest('hex');
  const row = db.prepare('SELECT * FROM users WHERE username = ? AND password_hash = ?').get(username, hash) as any;
  if (!row) return res.json({ ok: false, error: '用户名或密码错误' });
  const token = signToken(row.id, row.name);
  res.json({ ok: true, data: { token, name: row.name } });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ ok: true, data: { name: (req as any).user.name } });
});

// 修改密码
app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const userId = (req as any).user.id;
  const oldHash = crypto.createHash('sha256').update(oldPassword).digest('hex');
  const row = db.prepare('SELECT id FROM users WHERE id = ? AND password_hash = ?').get(userId, oldHash) as any;
  if (!row) return res.json({ ok: false, error: '原密码错误' });
  if (!newPassword || newPassword.length < 6) return res.json({ ok: false, error: '新密码至少 6 位' });
  const newHash = crypto.createHash('sha256').update(newPassword).digest('hex');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, userId);
  res.json({ ok: true });
});

// ===== Admin: Profile (draft + published) =====
app.get('/api/admin/profile', requireAuth, (req, res) => {
  const row = db.prepare('SELECT data, updated_at FROM profiles WHERE id = 1').get() as any;
  const pubRow = db.prepare('SELECT data, updated_at FROM published_profiles WHERE id = 1').get() as any;
  res.json({
    ok: true,
    data: {
      profile: JSON.parse(row.data),
      updatedAt: row.updated_at,
      publishedAt: pubRow?.updated_at || null,
    }
  });
});

app.put('/api/admin/profile', requireAuth, (req, res) => {
  db.prepare('UPDATE profiles SET data = ?, updated_at = datetime(\'now\') WHERE id = 1').run(JSON.stringify(req.body.profile));
  res.json({ ok: true });
});

// 发布：将草稿复制为已发布版本
app.post('/api/admin/profile/publish', requireAuth, (req, res) => {
  const row = db.prepare('SELECT data FROM profiles WHERE id = 1').get() as any;
  db.prepare('UPDATE published_profiles SET data = ?, updated_at = datetime(\'now\') WHERE id = 1').run(row.data);
  res.json({ ok: true, data: { publishedAt: new Date().toISOString() } });
});

// ===== Admin: Upload & Parse Resume File =====
app.post('/api/admin/parse', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: '请上传文件' });
  let origName = req.file.originalname;
  try { origName = Buffer.from(origName, 'latin1').toString('utf8'); } catch {}
  const ext = origName.split('.').pop()?.toLowerCase();
  try {
    let text = '';
    if (ext === 'pdf') {
      text = await parsePdf(req.file.buffer);
    } else if (ext === 'docx') {
      text = await parseDocx(req.file.buffer);
    } else {
      return res.status(400).json({ ok: false, error: '仅支持 PDF 和 .docx 格式' });
    }
    // 先用规则解析，再用 LLM 增强
    const parsed = extractProfileFromText(text);
    const llmParsed = await parseResumeWithLLM(text);
    const final = llmParsed ? { ...parsed, ...llmParsed } : parsed;
    res.json({ ok: true, data: { parsed: final, rawText: text.slice(0, 2000) } });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: '解析失败：' + e.message });
  }
});

// ===== Admin: Persona =====
app.get('/api/admin/persona', requireAuth, (req, res) => {
  const row = db.prepare('SELECT data FROM personas WHERE id = 1').get() as any;
  res.json({ ok: true, data: { persona: JSON.parse(row.data) } });
});

app.put('/api/admin/persona', requireAuth, (req, res) => {
  db.prepare('UPDATE personas SET data = ? WHERE id = 1').run(JSON.stringify(req.body.persona));
  res.json({ ok: true });
});

// ===== Admin: Q&A =====
app.get('/api/admin/qa', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM qa_pairs ORDER BY created_at DESC').all() as any[];
  const list: QAPair[] = rows.map(r => {
    let variants: string[] = [];
    let tags: string[] = [];
    try {
      const v = JSON.parse(r.variants);
      variants = Array.isArray(v) ? v : String(v || '').split(/[,，\n]/).filter(Boolean);
    } catch { variants = String(r.variants || '').split(/[,，\n]/).filter(Boolean); }
    try {
      const t = JSON.parse(r.tags);
      tags = Array.isArray(t) ? t : [];
    } catch { tags = []; }
    return { id: r.id, question: r.question, answer: r.answer, variants, tags, enabled: !!r.enabled };
  });
  res.json({ ok: true, data: { list } });
});

app.post('/api/admin/qa', requireAuth, (req, res) => {
  const { question, answer, variants = [], tags = [], enabled = true } = req.body;
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO qa_pairs (id, question, variants, answer, tags, enabled) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, question, JSON.stringify(variants), answer, JSON.stringify(tags), enabled ? 1 : 0);
  res.json({ ok: true, data: { id } });
});

app.put('/api/admin/qa/:id', requireAuth, (req, res) => {
  const { question, answer, variants, tags, enabled } = req.body;
  db.prepare('UPDATE qa_pairs SET question=?, variants=?, answer=?, tags=?, enabled=? WHERE id=?')
    .run(question, JSON.stringify(variants || []), answer, JSON.stringify(tags || []), enabled ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/admin/qa/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM qa_pairs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ===== Admin: Knowledge Docs =====
app.get('/api/admin/knowledge', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT id, filename, tags, file_type, created_at, LENGTH(content) as size FROM knowledge_docs ORDER BY created_at DESC').all() as any[];
  const list = rows.map(r => ({
    id: r.id, filename: r.filename, fileType: r.file_type,
    tags: JSON.parse(r.tags || '[]'), size: r.size, createdAt: r.created_at,
  }));
  res.json({ ok: true, data: { list } });
});

app.get('/api/admin/knowledge/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM knowledge_docs WHERE id = ?').get(req.params.id) as any;
  if (!row) return res.status(404).json({ ok: false, error: '文件不存在' });
  res.json({ ok: true, data: { id: row.id, filename: row.filename, content: row.content, tags: JSON.parse(row.tags || '[]'), fileType: row.file_type, createdAt: row.created_at } });
});

app.post('/api/admin/knowledge', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: '请上传文件' });
  const tags = JSON.parse(req.body.tags || '[]');
  // 修复中文文件名乱码
  let filename = req.file.originalname;
  try { filename = Buffer.from(filename, 'latin1').toString('utf8'); } catch {}
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  let content = '';
  try {
    if (ext === 'pdf') {
      content = await parsePdf(req.file.buffer);
    } else if (ext === 'docx') {
      try {
        content = await parseDocx(req.file.buffer);
      } catch {
        // docx 解析失败时，尝试按文本读取
        content = req.file.buffer.toString('utf-8').replace(/[^\x20-\x7E\xA0-\xFF\u4e00-\u9fff\n\r\t]/g, '').slice(0, 50000);
      }
    } else if (['md', 'markdown', 'txt', 'csv'].includes(ext)) {
      content = req.file.buffer.toString('utf-8');
    } else {
      content = req.file.buffer.toString('utf-8');
    }
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: '解析失败: ' + e.message });
  }
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO knowledge_docs (id, filename, content, tags, file_type) VALUES (?, ?, ?, ?, ?)')
    .run(id, filename, content, JSON.stringify(tags), ext);
  res.json({ ok: true, data: { id } });
});

app.put('/api/admin/knowledge/:id/tags', requireAuth, (req, res) => {
  const { tags } = req.body;
  db.prepare('UPDATE knowledge_docs SET tags = ? WHERE id = ?').run(JSON.stringify(tags || []), req.params.id);
  res.json({ ok: true });
});

app.delete('/api/admin/knowledge/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM knowledge_docs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ===== Admin: Share Links =====
app.get('/api/admin/links', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM share_links ORDER BY created_at DESC').all() as any[];
  const list: ShareLink[] = rows.map(r => ({
    id: r.id, slug: r.slug, label: r.label, ref: r.ref,
    requireCode: !!r.require_code, code: r.code, expiresAt: r.expires_at,
    enabled: !!r.enabled, createdAt: r.created_at
  }));
  res.json({ ok: true, data: { list } });
});

app.post('/api/admin/links', requireAuth, (req, res) => {
  const { label = '', ref = '', requireCode = false, code = null, expiresAt = null } = req.body;
  const slug = generateSlug();
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO share_links (id, slug, label, ref, require_code, code, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, slug, label, ref, requireCode ? 1 : 0, code, expiresAt);
  res.json({ ok: true, data: { id, slug } });
});

app.put('/api/admin/links/:id', requireAuth, (req, res) => {
  const { label, ref, requireCode, code, expiresAt, enabled } = req.body;
  db.prepare('UPDATE share_links SET label=?, ref=?, require_code=?, code=?, expires_at=?, enabled=? WHERE id=?')
    .run(label, ref, requireCode ? 1 : 0, code, expiresAt, enabled ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/admin/links/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM share_links WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ===== Admin: Analytics =====
app.get('/api/admin/analytics/summary', requireAuth, (req, res) => {
  const todayVisitors = (db.prepare("SELECT COUNT(DISTINCT visitor_id) as c FROM visitor_sessions WHERE date(created_at) = date('now')").get() as any).c;
  const todayMessages = (db.prepare("SELECT COUNT(*) as c FROM visitor_messages WHERE date(created_at) = date('now')").get() as any).c;
  const totalSessions = (db.prepare('SELECT COUNT(*) as c FROM visitor_sessions').get() as any).c;
  const unanswered = (db.prepare('SELECT * FROM unanswered_questions ORDER BY hit_count DESC, last_seen DESC LIMIT 20').all() as any[])
    .map(r => ({ id: r.id, question: r.question, hitCount: r.hit_count, lastSeen: r.last_seen }));
  const recentSessions = (db.prepare(`
    SELECT s.id, s.visitor_id, s.created_at, l.label as share_label,
      (SELECT COUNT(*) FROM visitor_messages m WHERE m.session_id = s.id) as message_count
    FROM visitor_sessions s LEFT JOIN share_links l ON s.share_link_id = l.id
    ORDER BY s.created_at DESC LIMIT 20
  `).all() as any[]).map(r => ({
    id: r.id, visitorId: r.visitor_id, shareLinkId: null, shareLabel: r.share_label,
    createdAt: r.created_at, messageCount: r.message_count
  }));
  res.json({ ok: true, data: { todayVisitors, todayMessages, totalSessions, unanswered, recentSessions } });
});

app.get('/api/admin/sessions/:id/messages', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM visitor_messages WHERE session_id = ? ORDER BY created_at ASC').all(req.params.id) as any[];
  const list = rows.map(r => ({
    id: r.id, sessionId: r.session_id, role: r.role, content: r.content,
    citations: JSON.parse(r.citations), answered: !!r.answered, createdAt: r.created_at
  }));
  res.json({ ok: true, data: { list } });
});

// ===== Visitor: Init Session =====
app.post('/api/c/:slug/session', (req, res) => {
  const link = db.prepare('SELECT * FROM share_links WHERE slug = ? AND enabled = 1').get(req.params.slug) as any;
  if (!link) return res.status(404).json({ ok: false, error: '链接不存在或已失效' });
  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    return res.status(410).json({ ok: false, error: '链接已过期' });
  }
  if (link.require_code && link.code && req.body.code !== link.code) {
    return res.status(403).json({ ok: false, error: '访问码不正确' });
  }

  const visitorId = req.body.visitorId || crypto.randomUUID();
  const wantNew = req.body.newSession === true;

  // 如果访客已有会话且不需要新建，复用最近的一条
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
    name: profile.basics?.name || '',
    title: profile.basics?.title || '',
    city: profile.basics?.city || '',
    summary: profile.summary || '',
    links: profile.basics?.links || [],
    experienceCount: (profile.experiences || []).length,
    projectCount: (profile.projects || []).length,
    skills: (profile.skills || []).map(g => ({ group: g.group, items: (g.items || []).map(i => i.name) }))
  } : { name: '', title: '', city: '', summary: '', links: [], experienceCount: 0, projectCount: 0, skills: [] };

  res.json({ ok: true, data: { visitorId, sessionId, profilePublic: pub } });
});

// 列出访客的所有会话
app.get('/api/c/:slug/sessions', (req, res) => {
  const visitorId = req.query.visitorId as string;
  if (!visitorId) return res.json({ ok: true, data: { sessions: [] } });
  const rows = db.prepare(`
    SELECT s.id, s.created_at,
      (SELECT content FROM visitor_messages WHERE session_id = s.id AND role = 'user' ORDER BY created_at ASC LIMIT 1) as first_msg,
      (SELECT content FROM visitor_messages WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1) as last_msg,
      (SELECT COUNT(*) FROM visitor_messages WHERE session_id = s.id) as msg_count
    FROM visitor_sessions s
    WHERE s.visitor_id = ?
    ORDER BY s.created_at DESC
  `).all(visitorId) as any[];
  res.json({ ok: true, data: { sessions: rows.map(r => ({
    id: r.id, createdAt: r.created_at,
    title: (r.first_msg || '新会话').slice(0, 20),
    lastMessage: (r.last_msg || '').slice(0, 40),
    messageCount: r.msg_count,
  })) }});
});

// 获取指定会话的历史消息
app.get('/api/c/:slug/sessions/:sessionId/messages', (req, res) => {
  const rows = db.prepare('SELECT role, content FROM visitor_messages WHERE session_id = ? ORDER BY created_at ASC').all(req.params.sessionId) as any[];
  res.json({ ok: true, data: { messages: rows.map(r => ({ role: r.role, content: r.content })) } });
});

// 删除会话
app.delete('/api/c/:slug/sessions/:sessionId', (req, res) => {
  db.prepare('DELETE FROM visitor_messages WHERE session_id = ?').run(req.params.sessionId);
  db.prepare('DELETE FROM visitor_sessions WHERE id = ?').run(req.params.sessionId);
  res.json({ ok: true });
});

// ===== Visitor: Chat (SSE stream with real LLM) =====
import { streamChatWithLLM } from './llm.js';

// 临时存储 runId → 待回答的问题（SSE 连接时取出），带过期清理
const pendingRuns = new Map<string, { sessionId: string; content: string; model?: string; ts: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingRuns) {
    if (now - v.ts > 120000) pendingRuns.delete(k); // 2 分钟过期
  }
}, 60000);

app.post('/api/c/:slug/messages', (req, res) => {
  const { sessionId, content, model } = req.body;
  if (!sessionId || !content) return res.status(400).json({ ok: false, error: '缺少参数' });

  // 限流：每 session 每日 30 条
  const msgCount = (db.prepare("SELECT COUNT(*) as c FROM visitor_messages WHERE session_id = ? AND date(created_at) = date('now')").get(sessionId) as any).c;
  if (msgCount >= 30) {
    return res.status(429).json({ ok: false, error: '今日对话已达上限，明天再来聊聊吧' });
  }

  const runId = crypto.randomUUID();

  // 保存用户消息
  db.prepare('INSERT INTO visitor_messages (id, session_id, role, content, citations, answered) VALUES (?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), sessionId, 'user', content, '[]', 1);

  // 暂存待回答内容，等 SSE 连接时触发 LLM
  pendingRuns.set(runId, { sessionId, content, model, ts: Date.now() });

  res.json({ ok: true, data: { runId } });
});

// SSE 事件流 —— 调用真实 LLM 流式输出
app.get('/api/runs/:id/events', async (req, res) => {
  const runId = req.params.id;
  const sessionId = req.query.sessionId as string;
  if (!sessionId) return res.status(400).end();

  const pending = pendingRuns.get(runId);
  if (!pending) return res.status(404).end();
  pendingRuns.delete(runId);

  const userQuery = pending.content;

  // 读取历史对话（最近 10 条）
  const historyRows = db.prepare(
    "SELECT role, content FROM visitor_messages WHERE session_id = ? AND role IN ('user','assistant') ORDER BY created_at DESC LIMIT 10"
  ).all(sessionId) as any[];
  const history = historyRows.reverse().map(r => ({ role: r.role, content: r.content }));

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  let seq = 0;
  res.write(`id: ${seq++}\nevent: start\ndata: {}\n\n`);

  let fullAnswer = '';
  try {
    await streamChatWithLLM(
      userQuery, history,
      (token) => {
        fullAnswer += token;
        res.write(`id: ${seq++}\nevent: delta\ndata: ${JSON.stringify({ text: token })}\n\n`);
      },
      pending.model,
    );
  } catch (e: any) {
    console.error('LLM 调用失败:', e.message, e?.status, e?.error);
    fullAnswer = '抱歉，暂时无法回答这个问题，请稍后再试。';
    res.write(`id: ${seq++}\nevent: delta\ndata: ${JSON.stringify({ text: fullAnswer })}\n\n`);
  }

  // 兜底：模型返回空内容时
  if (!fullAnswer || !fullAnswer.trim()) {
    fullAnswer = '这个问题我不太确定，建议直接问我本人。';
    res.write(`id: ${seq++}\nevent: delta\ndata: ${JSON.stringify({ text: fullAnswer })}\n\n`);
  }

  // 解析引用标记 [来源:xxx]
  const citationMatches = [...fullAnswer.matchAll(/\[来源:([^\]]+)\]/g)];
  const citations = citationMatches.map(m => ({ type: 'doc', id: m[1], label: m[1] }));
  const cleanAnswer = fullAnswer.replace(/\[来源:[^\]]+\]/g, '').trim();

  db.prepare('INSERT INTO visitor_messages (id, session_id, role, content, citations, answered) VALUES (?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), sessionId, 'assistant', cleanAnswer, JSON.stringify(citations), 1);

  res.write(`id: ${seq++}\nevent: citations\ndata: ${JSON.stringify({ citations })}\n\n`);
  res.write(`id: ${seq++}\nevent: done\ndata: {}\n\n`);
  res.end();
});

function generateSlug(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < 10; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

// 生产环境：托管前端静态文件
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(__dirname, '../../web/dist');
console.log('Static dist path:', webDist, 'exists:', fs.existsSync(webDist));
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist, { index: 'index.html' }));
  // SPA 路由回退：所有非 API 路由返回 index.html
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
