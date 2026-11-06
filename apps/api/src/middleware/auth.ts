import { Request, Response, NextFunction } from 'express';
import { UserProfile, Permissions } from '../types';

// Mock auth middleware for development
// In production, this would verify Supabase JWTs
export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // For development, mock an authenticated user
  const mockUser: UserProfile = {
    id: 'mock-user-id',
    email: process.env.MOCK_USER_EMAIL || 'dev@example.com',
    name: process.env.MOCK_USER_NAME || 'Developer',
    role: (process.env.MOCK_USER_ROLE as any) || 'contributor',
    permissions: getPermissionsForRole((process.env.MOCK_USER_ROLE as any) || 'contributor'),
    restaurant_id: 'mock-restaurant-id',
    created_at: new Date().toISOString()
  };

  res.locals.user = mockUser;
  next();
};

const getPermissionsForRole = (role: string): Permissions => {
  const base: Permissions = {
    brand: { view: false, edit: false, approve: false },
    publish: { view: false, execute: false },
    users: { view: false, invite: false, manage_roles: false },
    data: { import: false, export: false, view_sensitive: false },
    analytics: { view: false, view_sensitive: false }
  };

  switch (role) {
    case 'admin':
      return {
        brand: { view: true, edit: true, approve: true },
        publish: { view: true, execute: true },
        users: { view: true, invite: true, manage_roles: true },
        data: { import: true, export: true, view_sensitive: true },
        analytics: { view: true, view_sensitive: true }
      };
    case 'approver':
      return {
        brand: { view: true, edit: false, approve: true },
        publish: { view: true, execute: true },
        users: { view: true, invite: false, manage_roles: false },
        data: { import: false, export: false, view_sensitive: false },
        analytics: { view: true, view_sensitive: false }
      };
    case 'contributor':
      return {
        brand: { view: true, edit: true, approve: false },
        publish: { view: true, execute: false },
        users: { view: true, invite: false, manage_roles: false },
        data: { import: true, export: false, view_sensitive: false },
        analytics: { view: true, view_sensitive: false }
      };
    case 'viewer':
      return {
        brand: { view: true, edit: false, approve: false },
        publish: { view: true, execute: false },
        users: { view: true, invite: false, manage_roles: false },
        data: { import: false, export: false, view_sensitive: false },
        analytics: { view: true, view_sensitive: false }
      };
    default:
      return base;
  }
};
