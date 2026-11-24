import { Request, Response, NextFunction } from 'express';
import { RATE_LIMITS } from '../config.js';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const stores = new Map<string, RateLimitEntry>();

function getClientKey(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

function createRateLimiter(
  windowMs: number,
  maxRequests: number,
  message: string,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${req.path}:${getClientKey(req)}`;
    const now = Date.now();
    const entry = stores.get(key);

    if (!entry || now > entry.resetTime) {
      stores.set(key, { count: 1, resetTime: now + windowMs });
      setRateLimitHeaders(res, maxRequests, maxRequests - 1, entry?.resetTime ?? now + windowMs);
      next();
      return;
    }

    if (entry.count >= maxRequests) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      setRateLimitHeaders(res, maxRequests, 0, entry.resetTime);
      res.status(429).json({ error: message, code: 'rate_limited' });
      return;
    }

    entry.count += 1;
    setRateLimitHeaders(res, maxRequests, maxRequests - entry.count, entry.resetTime);
    next();
  };
}

function setRateLimitHeaders(
  res: Response,
  limit: number,
  remaining: number,
  resetTime: number,
): void {
  res.set('X-RateLimit-Limit', String(limit));
  res.set('X-RateLimit-Remaining', String(Math.max(0, remaining)));
  res.set('X-RateLimit-Reset', String(Math.ceil(resetTime / 1000)));
}

export const analyzeRateLimiter = createRateLimiter(
  60_000,
  RATE_LIMITS.analyze,
  'Too many analysis requests. Please wait before trying again.',
);

export const analyzeSourceRateLimiter = createRateLimiter(
  60_000,
  RATE_LIMITS.analyzeSource,
  'Too many source analysis requests. Please wait before trying again.',
);

export const projectIntakeRateLimiter = createRateLimiter(
  60_000,
  RATE_LIMITS.projectIntake,
  'Too many project intake requests. Please wait before trying again.',
);

// Cleanup old entries periodically to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of stores.entries()) {
    if (now > entry.resetTime) {
      stores.delete(key);
    }
  }
}, 60_000);

export function clearRateLimitStore(): void {
  stores.clear();
}