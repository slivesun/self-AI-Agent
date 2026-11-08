import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { db } from './db.js';

/**
 * 管理端写操作审计：记录方法、路径、状态、操作者与 IP 哈希。
 * 只记非 GET 请求，避免把浏览后台的噪音写进表里。
 */
export function auditAdminMutations(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'OPTIONS') return next();

  res.on('finish', () => {
    try {
      const userId = Number((req as any).user?.sub);
      db.prepare('INSERT INTO admin_audit_logs (user_id, method, path, status, ip_hash) VALUES (?, ?, ?, ?, ?)')
        .run(
          Number.isFinite(userId) ? userId : null,
          req.method,
          req.originalUrl.split('?')[0].slice(0, 200),
          res.statusCode,
          crypto.createHash('sha256').update(req.ip || '').digest('hex').slice(0, 16),
        );
    } catch (e: any) {
      console.warn('[audit] 写入失败:', e?.message || e);
    }
  });

  next();
}
