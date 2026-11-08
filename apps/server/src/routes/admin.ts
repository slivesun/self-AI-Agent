import { Router } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { getSetting, setSetting, maskSecret } from '../settings.js';
import { parsePdf, parseDocx, extractProfileFromText, parseResumeWithLLM } from '../parse.js';
import { fixFilename } from '../utils.js';
import type { QAPair } from '@resume-agent/shared';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ===== 档案（草稿+发布）=====
router.get('/profile', requireAuth, (req, res) => {
  const row = db.prepare('SELECT data, updated_at FROM profiles WHERE id = 1').get() as any;
  const pubRow = db.prepare('SELECT data, updated_at FROM published_profiles WHERE id = 1').get() as any;
  res.json({ ok: true, data: { profile: JSON.parse(row.data), updatedAt: row.updated_at, publishedAt: pubRow?.updated_at || null } });
});

router.put('/profile', requireAuth, (req, res) => {
  db.prepare('UPDATE profiles SET data = ?, updated_at = datetime(\'now\') WHERE id = 1').run(JSON.stringify(req.body.profile));
  res.json({ ok: true });
});

router.post('/profile/publish', requireAuth, (req, res) => {
  const row = db.prepare('SELECT data FROM profiles WHERE id = 1').get() as any;
  db.prepare('UPDATE published_profiles SET data = ?, updated_at = datetime(\'now\') WHERE id = 1').run(row.data);
  res.json({ ok: true, data: { publishedAt: new Date().toISOString() } });
});

// ===== 上传简历解析 =====
router.post('/parse', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: '请上传文件' });
  const origName = fixFilename(req.file.originalname);
  const ext = origName.split('.').pop()?.toLowerCase();
  try {
    let text = '';
    if (ext === 'pdf') text = await parsePdf(req.file.buffer);
    else if (ext === 'docx') text = await parseDocx(req.file.buffer);
    else return res.status(400).json({ ok: false, error: '仅支持 PDF 和 .docx 格式' });
    const parsed = extractProfileFromText(text);
    const llmParsed = await parseResumeWithLLM(text);
    const final = llmParsed ? { ...parsed, ...llmParsed } : parsed;
    res.json({ ok: true, data: { parsed: final, rawText: text.slice(0, 2000) } });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: '解析失败：' + e.message });
  }
});

// ===== 人设 =====
router.get('/persona', requireAuth, (req, res) => {
  const row = db.prepare('SELECT data FROM personas WHERE id = 1').get() as any;
  res.json({ ok: true, data: { persona: JSON.parse(row.data) } });
});

router.put('/persona', requireAuth, (req, res) => {
  db.prepare('UPDATE personas SET data = ? WHERE id = 1').run(JSON.stringify(req.body.persona));
  res.json({ ok: true });
});

// ===== Q&A =====
router.get('/qa', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM qa_pairs ORDER BY created_at DESC').all() as any[];
  const list: QAPair[] = rows.map(r => {
    let variants: string[] = []; let tags: string[] = [];
    try { const v = JSON.parse(r.variants); variants = Array.isArray(v) ? v : String(v || '').split(/[,，\n]/).filter(Boolean); } catch { variants = String(r.variants || '').split(/[,，\n]/).filter(Boolean); }
    try { const t = JSON.parse(r.tags); tags = Array.isArray(t) ? t : []; } catch { tags = []; }
    return { id: r.id, question: r.question, answer: r.answer, variants, tags, enabled: !!r.enabled };
  });
  res.json({ ok: true, data: { list } });
});

router.post('/qa', requireAuth, (req, res) => {
  const { question, answer, variants = [], tags = [], enabled = true } = req.body;
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO qa_pairs (id, question, variants, answer, tags, enabled) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, question, JSON.stringify(variants), answer, JSON.stringify(tags), enabled ? 1 : 0);
  res.json({ ok: true, data: { id } });
});

router.put('/qa/:id', requireAuth, (req, res) => {
  const { question, answer, variants, tags, enabled } = req.body;
  db.prepare('UPDATE qa_pairs SET question=?, variants=?, answer=?, tags=?, enabled=? WHERE id=?')
    .run(question, JSON.stringify(variants || []), answer, JSON.stringify(tags || []), enabled ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

router.delete('/qa/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM qa_pairs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ===== 数据分析 =====
router.get('/analytics/summary', requireAuth, (req, res) => {
  const todayVisitors = (db.prepare("SELECT COUNT(DISTINCT visitor_id) as c FROM visitor_sessions WHERE date(created_at) = date('now')").get() as any).c;
  const todayMessages = (db.prepare("SELECT COUNT(*) as c FROM visitor_messages WHERE date(created_at) = date('now')").get() as any).c;
  const totalSessions = (db.prepare('SELECT COUNT(*) as c FROM visitor_sessions').get() as any).c;
  const unanswered = (db.prepare('SELECT * FROM unanswered_questions ORDER BY hit_count DESC, last_seen DESC LIMIT 20').all() as any[])
    .map(r => ({ id: r.id, question: r.question, hitCount: r.hit_count, lastSeen: r.last_seen }));
  const recentSessions = (db.prepare(`
    SELECT s.id, s.visitor_id, s.created_at, l.label as share_label,
      (SELECT COUNT(*) FROM visitor_messages m WHERE m.session_id = s.id) as message_count,
      (SELECT content FROM visitor_messages m WHERE m.session_id = s.id AND m.role = 'user' ORDER BY m.created_at ASC LIMIT 1) as first_question
    FROM visitor_sessions s LEFT JOIN share_links l ON s.share_link_id = l.id
    WHERE (SELECT COUNT(*) FROM visitor_messages m WHERE m.session_id = s.id) > 0
    ORDER BY s.created_at DESC LIMIT 20
  `).all() as any[]).map(r => ({
    id: r.id, visitorId: r.visitor_id, shareLinkId: null, shareLabel: r.share_label,
    createdAt: r.created_at, messageCount: r.message_count,
    firstQuestion: r.first_question ? r.first_question.slice(0, 40) : ''
  }));
  res.json({ ok: true, data: { todayVisitors, todayMessages, totalSessions, unanswered, recentSessions } });
});

router.get('/sessions/:id/messages', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM visitor_messages WHERE session_id = ? ORDER BY created_at ASC').all(req.params.id) as any[];
  const list = rows.map(r => ({
    id: r.id, sessionId: r.session_id, role: r.role, content: r.content,
    citations: JSON.parse(r.citations || '[]'), answered: !!r.answered, createdAt: r.created_at
  }));
  res.json({ ok: true, data: { list } });
});

// ===== 管理操作审计 =====
router.get('/audit', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT id, user_id, method, path, status, ip_hash, created_at
    FROM admin_audit_logs ORDER BY id DESC LIMIT 100
  `).all() as any[];
  res.json({
    ok: true,
    data: {
      list: rows.map((r) => ({
        id: r.id, userId: r.user_id, method: r.method, path: r.path,
        status: r.status, ipHash: r.ip_hash, createdAt: r.created_at,
      })),
    },
  });
});

// ===== 模型设置（Key 存数据库，避免打进安装包） =====
router.get('/settings/llm', requireAuth, (req, res) => {
  const envKey = (process.env.ARK_API_KEY || '').trim();
  const dbKey = (getSetting('ark_api_key') || '').trim();
  const envModel = (process.env.ARK_MODEL || '').trim();
  const dbModel = (getSetting('ark_model') || '').trim();
  const key = envKey || dbKey;
  res.json({
    ok: true,
    data: {
      hasApiKey: !!key,
      apiKeyMasked: key ? maskSecret(key) : '',
      apiKeySource: envKey ? 'env' : dbKey ? 'db' : 'none',
      model: envModel || dbModel || 'doubao-seed-2-0-mini-260428',
      modelSource: envModel ? 'env' : dbModel ? 'db' : 'default',
      editable: !envKey,
    },
  });
});

router.put('/settings/llm', requireAuth, (req, res) => {
  const { apiKey, model, clearApiKey } = req.body || {};

  if (clearApiKey === true) {
    setSetting('ark_api_key', null);
  } else if (typeof apiKey === 'string' && apiKey.trim()) {
    const value = apiKey.trim();
    if (value.length > 200) return res.status(400).json({ ok: false, error: 'API Key 过长' });
    if (!/^[A-Za-z0-9._-]+$/.test(value)) return res.status(400).json({ ok: false, error: 'API Key 格式不正确' });
    setSetting('ark_api_key', value);
  }

  if (typeof model === 'string' && model.trim()) {
    const value = model.trim();
    if (value.length > 64 || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value)) {
      return res.status(400).json({ ok: false, error: '模型名格式不正确' });
    }
    setSetting('ark_model', value);
  }

  res.json({ ok: true });
});

export default router;
