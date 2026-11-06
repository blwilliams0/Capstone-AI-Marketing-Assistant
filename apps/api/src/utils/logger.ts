import { Request, Response, NextFunction } from 'express';

// Simple logger middleware
export const logger = (req: Request, res: Response, next: NextFunction) => {
  const timestamp = new Date().toISOString();
  const method = req.method;
  const url = req.url;
  
  console.log(\[\] \ \\);
  
  next();
};

// Error logger
export const errorLogger = (err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('[ERROR]', err.message, err.stack);
  next(err);
};
