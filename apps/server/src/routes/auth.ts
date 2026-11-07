import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../db.js';
import { signToken, requireAuth } from '../auth.js';

const router = Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const hash = crypto.createHash('sha256').update(password || '').digest('hex');
  const row = db.prepare('SELECT * FROM users WHERE username = ? AND password_hash = ?').get(username, hash) as any;
  if (!row) return res.json({ ok: false, error: '用户名或密码错误' });
  const token = signToken(row.id, row.name);
  res.json({ ok: true, data: { token, name: row.name } });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ ok: true, data: { name: (req as any).user.name } });
});

router.post('/change-password', requireAuth, (req, res) => {
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

export default router;
