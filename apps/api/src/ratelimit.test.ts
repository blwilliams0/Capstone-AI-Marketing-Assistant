import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Db } from '@the-pocket/db';
import { createApp } from './app.js';
import { createMockAuthenticator } from './auth/authenticator.js';
import { rateLimit } from './middleware.js';

describe('rate limiting', () => {
  it('returns 429 with Retry-After once a user exceeds the limit', async () => {
    const { app } = createApp({
      db: {} as Db,
      authenticator: createMockAuthenticator(),
      webOrigin: 'http://localhost:5173',
      rateLimits: { perUser: { windowMs: 60_000, max: 3 } },
    });
    const me = () => request(app).get('/api/me').set('Authorization', 'Bearer mock:viewer');
    for (let i = 0; i < 3; i++) expect((await me()).status).toBe(200);
    const blocked = await me();
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.body.error).toMatch(/Too many requests/);
  });

  it('counts each user separately', async () => {
    const { app } = createApp({
      db: {} as Db,
      authenticator: createMockAuthenticator(),
      webOrigin: 'http://localhost:5173',
      rateLimits: { perUser: { windowMs: 60_000, max: 1 } },
    });
    expect((await request(app).get('/api/me').set('Authorization', 'Bearer mock:viewer')).status).toBe(200);
    expect((await request(app).get('/api/me').set('Authorization', 'Bearer mock:viewer')).status).toBe(429);
    expect((await request(app).get('/api/me').set('Authorization', 'Bearer mock:admin')).status).toBe(200);
  });

  it('limits unauthenticated floods by IP before token checks', async () => {
    const { app } = createApp({
      db: {} as Db,
      authenticator: createMockAuthenticator(),
      webOrigin: 'http://localhost:5173',
      rateLimits: { perIp: { windowMs: 60_000, max: 2 } },
    });
    expect((await request(app).get('/api/me')).status).toBe(401);
    expect((await request(app).get('/api/me')).status).toBe(401);
    expect((await request(app).get('/api/me')).status).toBe(429);
    expect((await request(app).get('/health')).status).toBe(200); // health is never limited
  });

  it('resets after the window passes', async () => {
    let t = 0;
    const app = express();
    app.use(rateLimit({ windowMs: 1000, max: 1, key: () => 'k', now: () => t }));
    app.get('/', (_req, res) => {
      res.send('ok');
    });
    expect((await request(app).get('/')).status).toBe(200);
    expect((await request(app).get('/')).status).toBe(429);
    t = 1001;
    expect((await request(app).get('/')).status).toBe(200);
  });
});
