import { describe, it, expect } from 'vitest';
import { ROLES, CAPABILITIES, roleHas, ADMIN_ONLY_CAPABILITIES } from './roles.js';

describe('permission matrix (PRD section 2)', () => {
  it('admin has every capability', () => {
    for (const c of CAPABILITIES) expect(roleHas('admin', c)).toBe(true);
  });
  it('only admin holds admin-only capabilities', () => {
    for (const c of ADMIN_ONLY_CAPABILITIES)
      for (const r of ROLES) expect(roleHas(r, c)).toBe(r === 'admin');
  });
  it('approver can approve posts but not brand rules or users', () => {
    expect(roleHas('approver', 'post.approve')).toBe(true);
    expect(roleHas('approver', 'brand.approve')).toBe(false);
    expect(roleHas('approver', 'users.invite')).toBe(false);
  });
  it('contributor can draft and request approval but never approve or publish', () => {
    expect(roleHas('contributor', 'content.draft')).toBe(true);
    expect(roleHas('contributor', 'approval.request')).toBe(true);
    expect(roleHas('contributor', 'post.approve')).toBe(false);
    expect(roleHas('contributor', 'channel.connect')).toBe(false);
    expect(roleHas('contributor', 'users.invite')).toBe(false);
  });
  it('everyone but viewers may propose knowledge; only admins approve it', () => {
    for (const r of ['admin', 'approver', 'contributor'] as const) expect(roleHas(r, 'knowledge.propose')).toBe(true);
    expect(roleHas('viewer', 'knowledge.propose')).toBe(false);
  });
  it('viewer is read-only', () => {
    expect(roleHas('viewer', 'content.draft')).toBe(false);
    expect(roleHas('viewer', 'knowledge.view')).toBe(true);
  });
});
