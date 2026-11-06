import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { router as apiRouter } from './routes';
import { authMiddleware } from './middleware/auth';
import { auditMiddleware } from './middleware/audit';
import { logger } from './utils/logger';

const app = express();
const PORT = process.env.API_PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(logger);

// Routes
app.use('/api', authMiddleware);
app.use('/api', auditMiddleware);
app.use('/api', apiRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(\Server running on port \\);
});

export default app;
