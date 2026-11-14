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
