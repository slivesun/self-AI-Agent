import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../db.js';
import { signToken, verifyToken } from '../auth.js';
import { hashPassword, verifyPassword, isLegacyHash } from '../password.js';
import { rateLimit } from '../rateLimit.js';

const router = Router();

function randomUsername(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: '注册过于频繁，请稍后再试',
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  key: (req) => `${req.ip}:${String((req.body as any)?.username || '').toLowerCase()}`,
  message: '登录尝试过于频繁，请 15 分钟后再试',
});

// 注册：用户可自定义账号密码，也可由系统生成
router.post('/register', registerLimiter, (req, res) => {
  const { nickname, username, password, avatar = '0' } = req.body || {};
  if (typeof nickname !== 'string' || !nickname.trim()) {
    return res.status(400).json({ ok: false, error: '请输入昵称' });
  }
  if (nickname.trim().length > 24) {
    return res.status(400).json({ ok: false, error: '昵称最长 24 个字' });
  }
  const uname = String(username || randomUsername()).trim();
  const generatedPassword = password ? '' : crypto.randomBytes(6).toString('base64url').slice(0, 8);
  const pwd = password || generatedPassword;
  if (!uname || uname.length < 3 || uname.length > 16) return res.status(400).json({ ok: false, error: '账号需3-16位' });
  if (!pwd || pwd.length < 6 || pwd.length > 32) return res.status(400).json({ ok: false, error: '密码需6-32位' });

  const id = crypto.randomUUID();
  try {
    db.prepare('INSERT INTO visitor_users (id, username, password_hash, nickname, avatar) VALUES (?, ?, ?, ?, ?)')
      .run(id, uname, hashPassword(pwd), nickname.trim(), String(avatar).slice(0, 4));
    const token = signToken(id, nickname.trim(), 'visitor');
    res.json({
      ok: true,
      data: {
        id, token, username: uname, nickname: nickname.trim(), avatar,
        // 系统生成的密码回传一次，否则用户之后无法登录
        generatedPassword: generatedPassword || undefined,
      },
    });
  } catch (e: any) {
    if (String(e?.message || '').includes('UNIQUE')) return res.status(409).json({ ok: false, error: '账号已被占用' });
    console.error('[visitor] 注册失败:', e?.message || e);
    res.status(500).json({ ok: false, error: '注册失败，请稍后再试' });
  }
});

// 登录
router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ ok: false, error: '请输入账号和密码' });
  }
  const row = db.prepare('SELECT * FROM visitor_users WHERE username = ?').get(username.trim()) as any;
  if (!row || !verifyPassword(password, row.password_hash)) {
    return res.status(401).json({ ok: false, error: '账号或密码错误' });
  }
  if (isLegacyHash(row.password_hash)) {
    db.prepare('UPDATE visitor_users SET password_hash = ? WHERE id = ?').run(hashPassword(password), row.id);
  }
  const token = signToken(row.id, row.nickname, 'visitor');
  res.json({ ok: true, data: { id: row.id, token, username: row.username, nickname: row.nickname, avatar: row.avatar || '0' } });
});

// 获取当前用户（必须验签，不能只解 base64 payload）
router.get('/me', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ ok: false, error: '未登录' });
  const payload = verifyToken(auth.slice(7));
  if (!payload || payload.role !== 'visitor') return res.status(401).json({ ok: false, error: 'token 无效或已过期' });
  const row = db.prepare('SELECT id, username, nickname, avatar FROM visitor_users WHERE id = ?').get(payload.sub as any) as any;
  if (!row) return res.status(404).json({ ok: false, error: '用户不存在' });
  res.json({ ok: true, data: { id: String(row.id), username: row.username, nickname: row.nickname, avatar: row.avatar || '0' } });
});

export { randomUsername };
export default router;
