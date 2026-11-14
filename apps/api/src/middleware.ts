import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Authenticator } from './auth/authenticator.js';

export const requestId: RequestHandler = (req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
};

/** One structured line per request. Never logs headers, bodies or query strings. */
export const requestLogger: RequestHandler = (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(
      JSON.stringify({
        level: 'info',
        msg: 'request',
        requestId: req.requestId,
        method: req.method,
        path: req.baseUrl + req.path,
        status: res.statusCode,
        ms: Date.now() - start,
        userId: req.auth?.userId,
      }),
    );
  });
  next();
};

/** Requires a valid bearer token and a live membership. Everything under /api goes through this. */
export function authenticate(authenticator: Authenticator): RequestHandler {
  return async (req, res, next) => {
    const header = req.headers.authorization;
    const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
    if (!match?.[1]) {
      res.status(401).json({ error: 'Please sign in to continue.' });
      return;
    }
    const result = await authenticator.authenticate(match[1], req.requestId);
    if (!result.ok) {
      res.status(result.status).json({ error: result.message });
      return;
    }
    req.auth = result.auth;
    next();
  };
}

export interface RateLimitOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Requests allowed per key per window. */
  max: number;
  /** What to count by. Defaults to the signed-in user, else the client IP. */
  key?: (req: Parameters<RequestHandler>[0]) => string;
  now?: () => number;
}

/**
 * Small in-memory fixed-window rate limiter. Enough for one API process serving one restaurant;
 * if the API ever runs as several processes, move the counters into the database.
 */
export function rateLimit(opts: RateLimitOptions): RequestHandler {
  const now = opts.now ?? Date.now;
  const keyOf = opts.key ?? ((req) => req.auth?.userId ?? `ip:${req.ip ?? 'unknown'}`);
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req, res, next) => {
    const t = now();
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
    }
    const key = keyOf(req);
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + opts.windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    res.setHeader('RateLimit-Limit', String(opts.max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, opts.max - entry.count)));
    if (entry.count > opts.max) {
      const retryAfter = Math.ceil((entry.resetAt - t) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: `Too many requests. Please wait ${retryAfter} seconds and try again.` });
      return;
    }
    next();
  };
}

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'Not found.' });
};

/** Central error handler: logs details server-side, never leaks stack traces to clients. */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ level: 'error', msg: 'unhandled', requestId: req.requestId, error: message }));
  res.status(500).json({ error: 'Something went wrong on our side.', requestId: req.requestId });
};
