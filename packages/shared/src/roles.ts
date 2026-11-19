/** Single source of truth for roles and capabilities (PRD section 2, Architecture section 3). */
export const ROLES = ['admin', 'approver', 'contributor', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const CAPABILITIES = [
  'knowledge.view',
  'knowledge.propose',
  'assistant.use',
  'analytics.view',
  'content.view',
  'content.draft',
  'approval.request',
  'data.import',
  'post.approve',
  'post.record',
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
  approver: [
    'knowledge.view',
    'knowledge.propose',
    'assistant.use',
    'analytics.view',
    'content.view',
    'content.draft',
    'approval.request',
    'post.approve',
    'post.record',
  ],
  contributor: [
    'knowledge.view',
    'knowledge.propose',
    'assistant.use',
    'analytics.view',
    'content.view',
    'content.draft',
    'approval.request',
    'post.record',
    'data.import',
  ],
  viewer: ['knowledge.view', 'analytics.view', 'content.view'],
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
  approver: 'Reviews and approves other people\'s marketing posts, and can draft and post. Cannot change brand rules or manage staff.',
  contributor: 'Drafts content, submits it for review and posts approved content. Cannot approve.',
  viewer: 'Can read approved marketing material and reports. Cannot change anything.',
};
