import { Router } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { getSetting, setSetting, isKnowledgeAnswerEnabled, KNOWLEDGE_ANSWER_KEY } from '../settings.js';
import { parsePdf, parseDocx } from '../parse.js';
import { fixFilename } from '../utils.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT id, filename, tags, file_type, created_at, LENGTH(content) as size FROM knowledge_docs ORDER BY created_at DESC').all() as any[];
  const list = rows.map(r => ({
    id: r.id, filename: r.filename, fileType: r.file_type,
    tags: JSON.parse(r.tags || '[]'), size: r.size, createdAt: r.created_at,
  }));
  res.json({ ok: true, data: { list } });
});

// 知识归档开关：是否允许大模型把这些文档作为知识点分析、用于回答
// 注意必须放在 /:id 之前，否则会被当成文档 id
router.get('/config', requireAuth, (req, res) => {
  const count = (db.prepare('SELECT COUNT(*) as c FROM knowledge_docs').get() as any).c;
  res.json({ ok: true, data: { allowLlmAnalyze: isKnowledgeAnswerEnabled(), docCount: count } });
});

router.put('/config', requireAuth, (req, res) => {
  const { allowLlmAnalyze } = req.body || {};
  if (typeof allowLlmAnalyze !== 'boolean') {
    return res.status(400).json({ ok: false, error: '参数 allowLlmAnalyze 必须是布尔值' });
  }
  // 存 "1"/"0"：清空该键会回到默认开启，所以关闭时不能写空值
  setSetting(KNOWLEDGE_ANSWER_KEY, allowLlmAnalyze ? '1' : '0');
  res.json({ ok: true, data: { allowLlmAnalyze: getSetting(KNOWLEDGE_ANSWER_KEY) !== '0' } });
});

router.get('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM knowledge_docs WHERE id = ?').get(req.params.id) as any;
  if (!row) return res.status(404).json({ ok: false, error: '文件不存在' });
  res.json({ ok: true, data: { id: row.id, filename: row.filename, content: row.content, tags: JSON.parse(row.tags || '[]'), fileType: row.file_type, createdAt: row.created_at } });
});

router.post('/', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: '请上传文件' });
  const tags = JSON.parse(req.body.tags || '[]');
  const filename = fixFilename(req.file.originalname);
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  let content = '';
  try {
    if (ext === 'pdf') {
      content = await parsePdf(req.file.buffer);
    } else if (ext === 'docx') {
      try { content = await parseDocx(req.file.buffer); }
      catch { content = req.file.buffer.toString('utf-8').replace(/[^\x20-\x7E\xA0-\xFF\u4e00-\u9fff\n\r\t]/g, '').slice(0, 50000); }
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

router.put('/:id/tags', requireAuth, (req, res) => {
  const { tags } = req.body;
  db.prepare('UPDATE knowledge_docs SET tags = ? WHERE id = ?').run(JSON.stringify(tags || []), req.params.id);
  res.json({ ok: true });
});

router.put('/:id/rename', requireAuth, (req, res) => {
  const { filename } = req.body;
  if (!filename || !filename.trim()) return res.json({ ok: false, error: '文件名不能为空' });
  db.prepare('UPDATE knowledge_docs SET filename = ? WHERE id = ?').run(filename.trim(), req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM knowledge_docs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
