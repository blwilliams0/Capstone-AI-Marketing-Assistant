/** Single source of truth for roles and capabilities (PRD section 2, Architecture section 3). */
export const ROLES = ['admin', 'approver', 'contributor', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const CAPABILITIES = [
  'knowledge.view',
  'knowledge.propose',
  'analytics.view',
  'content.draft',
  'approval.request',
  'data.import',
  'post.approve',
  'brand.approve',
  'channel.connect',
  'users.invite',
  'users.manage',
  'data.export',
  'analytics.view_sensitive',
  'audit.view',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

const ADMIN_ONLY: Capability[] = [
  'brand.approve',
  'channel.connect',
  'users.invite',
  'users.manage',
  'data.export',
  'analytics.view_sensitive',
  'audit.view',
];

export const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  admin: CAPABILITIES,
  approver: ['knowledge.view', 'knowledge.propose', 'analytics.view', 'content.draft', 'post.approve'],
  contributor: [
    'knowledge.view',
    'knowledge.propose',
    'analytics.view',
    'content.draft',
    'approval.request',
    'data.import',
  ],
  viewer: ['knowledge.view', 'analytics.view'],
};

export const ADMIN_ONLY_CAPABILITIES: readonly Capability[] = ADMIN_ONLY;

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function capabilitiesFor(role: Role): readonly Capability[] {
  return ROLE_CAPABILITIES[role];
}

export function roleHas(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

/** Plain-English role descriptions shown when an admin invites someone. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: 'Runs the account: invites and removes staff, approves brand rules, connects accounts, sees the audit trail.',
  approver: 'Reviews and approves marketing posts. Cannot change brand rules or manage staff.',
  contributor: 'Drafts content and submits it for review. Cannot approve or publish.',
  viewer: 'Can read approved marketing material and reports. Cannot change anything.',
};
