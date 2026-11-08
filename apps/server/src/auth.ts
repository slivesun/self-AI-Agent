import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { db, DATA_DIR } from './db.js';

/**
 * JWT 密钥解析：优先环境变量；否则在数据目录持久化生成随机密钥。
 * 不再回退固定字符串，避免默认密钥导致 token 可伪造。
 */
function resolveJwtSecret(): string {
  const envSecret = (process.env.JWT_SECRET || '').trim();
  if (envSecret.length >= 16) return envSecret;
  if (envSecret) console.warn('[auth] JWT_SECRET 长度不足 16 位，已忽略');

  const secretFile = path.join(DATA_DIR, 'jwt.secret');
  try {
    if (fs.existsSync(secretFile)) {
      const saved = fs.readFileSync(secretFile, 'utf8').trim();
      if (saved.length >= 32) return saved;
    }
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secretFile, generated, { mode: 0o600 });
    console.log('[auth] 已生成持久化 JWT 密钥:', secretFile);
    return generated;
  } catch (err: any) {
    console.warn('[auth] JWT 密钥持久化失败，本次运行使用临时密钥:', err?.message || err);
    return crypto.randomBytes(32).toString('hex');
  }
}

const JWT_SECRET = resolveJwtSecret();
const TOKEN_TTL = '7d';
const STREAM_TOKEN_TTL = 120; // 秒：SSE 一次性凭证

export type TokenRole = 'admin' | 'visitor';

export function signToken(userId: number | string, name: string, role: TokenRole): string {
  return jwt.sign({ sub: userId, name, role }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export function verifyToken(token: string): { sub: any; name: string; role?: TokenRole } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as any;
  } catch {
    return null;
  }
}

/**
 * 后台接口鉴权：必须是管理员角色的 token，且账号仍然存在。
 * 访客 token 不能用于后台接口（此前只校验签名，存在越权隐患）。
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: '未登录' });
  }
  const payload = verifyToken(header.slice(7));
  if (!payload) {
    return res.status(401).json({ ok: false, error: 'token 无效或已过期' });
  }
  if (payload.role !== 'admin') {
    return res.status(403).json({ ok: false, error: '无权访问' });
  }
  const row = db.prepare('SELECT id, must_change_password FROM users WHERE id = ?').get(Number(payload.sub)) as
    { id: number; must_change_password: number } | undefined;
  if (!row) {
    return res.status(401).json({ ok: false, error: '账号不存在' });
  }
  (req as any).user = payload;
  (req as any).mustChangePassword = !!row.must_change_password;
  next();
}

/** 首次登录必须改密：改密前只放行改密/查询自身信息，其余后台接口拒绝 */
export function requirePasswordChanged(req: Request, res: Response, next: NextFunction) {
  if ((req as any).mustChangePassword) {
    return res.status(403).json({ ok: false, code: 'PASSWORD_CHANGE_REQUIRED', error: '请先修改默认密码' });
  }
  next();
}

/** SSE 一次性凭证：绑定 runId + sessionId，短时有效，避免把 token 拼进 URL */
export function signStreamToken(runId: string, sessionId: string): string {
  return jwt.sign({ runId, sessionId, role: 'stream' }, JWT_SECRET, { expiresIn: STREAM_TOKEN_TTL });
}

export function verifyStreamToken(token: string): { runId: string; sessionId: string } | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    if (!payload || payload.role !== 'stream') return null;
    return { runId: String(payload.runId), sessionId: String(payload.sessionId) };
  } catch {
    return null;
  }
}
