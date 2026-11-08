import { Router } from 'express';
import { db } from '../db.js';
import { signToken, requireAuth } from '../auth.js';
import { hashPassword, verifyPassword, isLegacyHash } from '../password.js';
import { rateLimit } from '../rateLimit.js';

const router = Router();

// 登录失败限流：同一 IP+账号 15 分钟内最多 10 次，防止口令爆破
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  key: (req) => `${req.ip}:${String((req.body as any)?.username || '').toLowerCase()}`,
  message: '登录尝试过于频繁，请 15 分钟后再试',
});

router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ ok: false, error: '请输入用户名和密码' });
  }
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim()) as any;
  if (!row || !verifyPassword(password, row.password_hash)) {
    return res.status(401).json({ ok: false, error: '用户名或密码错误' });
  }

  // 历史 sha256 哈希：登录成功后透明升级为 scrypt
  if (isLegacyHash(row.password_hash)) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), row.id);
  }

  const token = signToken(row.id, row.name, 'admin');
  res.json({ ok: true, data: { token, name: row.name, mustChangePassword: !!row.must_change_password } });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ ok: true, data: { name: (req as any).user.name, mustChangePassword: (req as any).mustChangePassword } });
});

router.post('/change-password', requireAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  // JWT 里用户 id 在 sub 上（此前误取 req.user.id，导致改密永远失败）
  const userId = Number((req as any).user?.sub);
  if (!Number.isFinite(userId)) {
    return res.status(401).json({ ok: false, error: '登录状态异常，请重新登录' });
  }
  if (typeof oldPassword !== 'string' || typeof newPassword !== 'string') {
    return res.status(400).json({ ok: false, error: '参数不完整' });
  }
  if (newPassword.length < 6 || newPassword.length > 64) {
    return res.status(400).json({ ok: false, error: '新密码需 6-64 位' });
  }
  if (newPassword === oldPassword) {
    return res.status(400).json({ ok: false, error: '新密码不能与原密码相同' });
  }

  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as any;
  if (!row || !verifyPassword(oldPassword, row.password_hash)) {
    return res.status(400).json({ ok: false, error: '原密码错误' });
  }

  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
    .run(hashPassword(newPassword), userId);
  res.json({ ok: true });
});

export default router;
