import type { Request, Response, NextFunction } from 'express';

/**
 * 轻量内存限流：单实例部署足够用（桌面端、单机服务）。
 * 需要多实例时替换为基于 Redis 的实现。
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60 * 1000);
cleanupTimer.unref?.();

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** 自定义限流维度，默认按 IP */
  key?: (req: Request) => string;
  message?: string;
}

export function rateLimit(options: RateLimitOptions) {
  const { windowMs, max, key, message = '请求过于频繁，请稍后再试' } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const identity = key ? key(req) : req.ip || 'unknown';
    const bucketKey = `${req.method}:${req.baseUrl}${req.path}:${identity}`;
    const now = Date.now();

    let bucket = buckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(bucketKey, bucket);
    }
    bucket.count += 1;

    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ ok: false, code: 'RATE_LIMITED', error: message });
    }

    next();
  };
}
