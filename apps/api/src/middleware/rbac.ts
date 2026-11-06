import { Request, Response, NextFunction } from 'express';
import { UserProfile } from '../types';

// Check if user has required permissions
export function requirePermissions(required: Partial<UserProfile['permissions']>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = res.locals.user as UserProfile;
    
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const hasPermission = checkPermissions(user.permissions, required);
    if (!hasPermission) {
      return res.status(403).json({ 
        error: 'Forbidden',
        message: 'You do not have permission to perform this action'
      });
    }
    
    next();
  };
}

const checkPermissions = (actual: any, required: any): boolean => {
  if (!required) return true;
  
  for (const [key, value] of Object.entries(required)) {
    if (typeof value === 'object') {
      if (!checkPermissions(actual[key], value)) {
        return false;
      }
    } else if (actual[key] !== true) {
      return false;
    }
  }
  
  return true;
};

// Helper to check if user can perform specific action
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = res.locals.user as UserProfile;
    
    if (!roles.includes(user.role)) {
      return res.status(403).json({ 
        error: 'Forbidden',
        message: 'You do not have permission to perform this action'
      });
    }
    
    next();
  };
}
