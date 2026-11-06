import { Router } from 'express';
import { router as apiRouter } from './routes';
import { mockQwen } from './mocks/qwen';
import { mockSocial } from './mocks/social';

const router = Router();

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Mock Qwen routes
router.post('/qwen/chat', mockQwen.chat);
router.post('/qwen/embeddings', mockQwen.embeddings);

// Mock social routes
router.post('/social/connect', mockSocial.connect);
router.post('/social/publish', mockSocial.publish);

// Brand routes (stub - to be implemented)
router.get('/brand/rules', (req, res) => {
  res.json({ rules: [] });
});

// User routes (stub - to be implemented)
router.get('/users/me', (req, res) => {
  res.json({ user: null });
});

export { router };
