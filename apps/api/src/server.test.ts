import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/server';
import { router } from '../src/routes';

vi.mock('../src/routes', () => ({
  router: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe('API Server', () => {
  it('should return 200 for health check', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('should include timestamp in health response', async () => {
    const response = await request(app).get('/health');
    expect(response.body).toHaveProperty('timestamp');
  });
});
