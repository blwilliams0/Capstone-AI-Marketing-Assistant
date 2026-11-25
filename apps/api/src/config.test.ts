import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { loadConfig } from './config.js';
import { createMockAuthenticator } from './auth/authenticator.js';
import { createApp } from './app.js';
import type { Db } from '@the-pocket/db';

const real = {
  SUPABASE_URL: 'https://example-project.supabase.co',
  DATABASE_URL: 'postgresql://user:pw@localhost:5432/db',
};

describe('configuration safety', () => {
  it('refuses mock auth in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', AUTH_MODE: 'mock' })).toThrow(/mock/i);
  });

  it('refuses mock auth when NODE_ENV is unset (fails closed)', () => {
    expect(() => loadConfig({ AUTH_MODE: 'mock' })).toThrow(/mock/i);
  });

  it('refuses mock auth in staging or any non-dev environment', () => {
    expect(() => loadConfig({ NODE_ENV: 'staging', AUTH_MODE: 'mock' })).toThrow(/mock/i);
  });

  it('allows mock auth only in development or test', () => {
    expect(loadConfig({ NODE_ENV: 'development', AUTH_MODE: 'mock' }).authMode).toBe('mock');
    expect(loadConfig({ NODE_ENV: 'test', AUTH_MODE: 'mock' }).authMode).toBe('mock');
  });

  it('keeps live photo advice opt-in and ignores live AI configuration in practice auth', () => {
    const paid = { ANTHROPIC_API_KEY: 'fictional-test-key' };
    expect(loadConfig({ ...real, ...paid }).livePhotoAdvice).toBe(false);
    expect(loadConfig({ ...real, ...paid, AI_LIVE_PHOTO_ADVICE: 'true' }).livePhotoAdvice).toBe(true);
    expect(loadConfig({ NODE_ENV: 'test', AUTH_MODE: 'mock', ...paid, AI_LIVE_PHOTO_ADVICE: 'true' })).toMatchObject({
      aiMode: 'mock', livePhotoAdvice: false,
    });
  });

  it('defaults to real Supabase authentication, never mock', () => {
    expect(loadConfig({ NODE_ENV: 'development', ...real }).authMode).toBe('supabase');
  });

  it('requires Supabase settings when using real auth', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/SUPABASE_URL/);
    expect(() => loadConfig({ NODE_ENV: 'production', SUPABASE_URL: real.SUPABASE_URL })).toThrow(/DATABASE_URL/);
  });

  it('rejects invalid values', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', ...real, API_PORT: 'abc' })).toThrow(/Invalid configuration/);
    expect(() => loadConfig({ NODE_ENV: 'production', ...real, WEB_ORIGIN: 'not a url' })).toThrow(/Invalid configuration/);
  });

  it('error messages never include secret values', () => {
    try {
      loadConfig({ NODE_ENV: 'production', ...real, API_PORT: 'abc', SUPABASE_SECRET_KEY: 'sb_secret_SHOULD_NOT_LEAK' });
    } catch (e) {
      expect(String(e)).not.toContain('SHOULD_NOT_LEAK');
      expect(String(e)).not.toContain('pw@localhost');
    }
  });
});

describe('mock authenticator (development only)', () => {
  const noDb = {} as Db;
  const { app } = createApp({ db: noDb, authenticator: createMockAuthenticator(), webOrigin: 'http://localhost:5173' });

  it('maps mock:<role> to that role and the shared permission matrix', async () => {
    const res = await request(app).get('/api/me').set('Authorization', 'Bearer mock:viewer');
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('viewer');
    expect(res.body.capabilities).not.toContain('users.invite');
  });

  it('still enforces the backend permission checks', async () => {
    const res = await request(app)
      .post('/api/admin/invitations')
      .set('Authorization', 'Bearer mock:contributor')
      .send({ email: 'a@example.test', name: 'A', role: 'admin' });
    expect(res.status).toBe(403);
  });

  it('rejects unknown roles and missing tokens', async () => {
    expect((await request(app).get('/api/me').set('Authorization', 'Bearer mock:owner')).status).toBe(401);
    expect((await request(app).get('/api/me')).status).toBe(401);
  });
});
