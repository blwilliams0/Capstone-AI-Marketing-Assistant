// Role definitions
export type Role = 'admin' | 'approver' | 'contributor' | 'viewer';

// Permission capabilities
export interface Permissions {
  brand: {
    view: boolean;
    edit: boolean;
    approve: boolean;
  };
  publish: {
    view: boolean;
    execute: boolean;
  };
  users: {
    view: boolean;
    invite: boolean;
    manage_roles: boolean;
  };
  data: {
    import: boolean;
    export: boolean;
    view_sensitive: boolean;
  };
  analytics: {
    view: boolean;
    view_sensitive: boolean;
  };
}

// User profile
export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: Role;
  permissions: Permissions;
  restaurant_id: string;
  created_at: string;
}

// Audit event types
export type AuditAction = 
  | 'user_invited'
  | 'role_changed'
  | 'user_revoked'
  | 'brand_approved'
  | 'brand_edited'
  | 'campaign_created'
  | 'campaign_approved'
  | 'publish_approved'
  | 'publish_executed'
  | 'csv_import_started'
  | 'csv_import_completed'
  | 'kpi_viewed'
  | 'expense_viewed';

// Brand rule interface
export interface BrandRule {
  id: string;
  category: 'voice' | 'hospitality' | 'menu' | 'photography' | 'banned_claims';
  title: string;
  content: string;
  version: number;
  priority: number;
  effective_from: string;
  effective_to?: string;
  approved_at?: string;
  approved_by?: string;
  created_at: string;
  updated_at: string;
}
