import { Request, Response, NextFunction } from 'express';
import { AuditAction } from '../types';

// Mock audit logger
export const auditLogger = (action: AuditAction, details: Record<string, unknown> = {}) => {
  console.log('[AUDIT]', action, JSON.stringify(details));
  // In production, this would write to the database
};

// Express middleware to automatically log requests
export const auditMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    auditLogger('request_completed', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: duration
    });
  });
  
  next();
};
