import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../db.js';
import { signToken } from '../auth.js';

const router = Router();

function hashPassword(pw: string) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

function randomUsername(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// 注册：用户可自定义账号密码，也可由系统生成
router.post('/register', (req, res) => {
  const { nickname, username, password, avatar = '0' } = req.body;
  if (!nickname || !nickname.trim()) return res.json({ ok: false, error: '请输入昵称' });
  const uname = (username || randomUsername()).trim();
  const pwd = password || Math.random().toString(36).slice(2, 10);
  if (!uname || uname.length < 3 || uname.length > 16) return res.json({ ok: false, error: '账号需3-16位' });
  if (!pwd || pwd.length < 6 || pwd.length > 32) return res.json({ ok: false, error: '密码需6-32位' });
  const id = crypto.randomUUID();
  try {
    db.prepare('INSERT INTO visitor_users (id, username, password_hash, nickname, avatar) VALUES (?, ?, ?, ?, ?)')
      .run(id, uname, hashPassword(pwd), nickname.trim(), avatar);
    const token = signToken(id, nickname.trim());
    res.json({ ok: true, data: { id, token, username: uname, nickname: nickname.trim(), avatar } });
  } catch (e: any) {
    if (e.message.includes('UNIQUE')) return res.json({ ok: false, error: '账号已被占用' });
    res.json({ ok: false, error: '注册失败：' + e.message });
  }
});

// 登录
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ ok: false, error: '请输入账号和密码' });
  const row = db.prepare('SELECT * FROM visitor_users WHERE username = ? AND password_hash = ?').get(username.trim(), hashPassword(password)) as any;
  if (!row) return res.json({ ok: false, error: '账号或密码错误' });
  const token = signToken(row.id, row.nickname);
  res.json({ ok: true, data: { id: row.id, token, username: row.username, nickname: row.nickname, avatar: row.avatar || '0' } });
});

// 获取当前用户
router.get('/me', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.json({ ok: false, error: '未登录' });
  const token = auth.replace('Bearer ', '');
  try {
    const decoded = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    const row = db.prepare('SELECT id, username, nickname, avatar FROM visitor_users WHERE id = ?').get(decoded.sub) as any;
    if (!row) return res.json({ ok: false, error: '用户不存在' });
    res.json({ ok: true, data: { id: String(row.id), username: row.username, nickname: row.nickname, avatar: row.avatar || '0' } });
  } catch {
    res.json({ ok: false, error: 'token 无效' });
  }
});

export { randomUsername };
export default router;
