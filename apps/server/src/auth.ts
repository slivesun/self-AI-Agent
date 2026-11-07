import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

export function signToken(userId: number, name: string): string {
  return jwt.sign({ sub: userId, name }, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): { sub: number; name: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { sub: number; name: string };
  } catch {
    return null;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: '未登录' });
  }
  const payload = verifyToken(header.slice(7));
  if (!payload) {
    return res.status(401).json({ ok: false, error: 'token 无效或已过期' });
  }
  (req as any).user = payload;
  next();
}
