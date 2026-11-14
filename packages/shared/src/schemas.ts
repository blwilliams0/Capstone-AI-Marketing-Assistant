import { z } from 'zod';
import { ROLES } from './roles.js';

export const roleSchema = z.enum(ROLES);

export const inviteRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().min(1).max(100),
  role: roleSchema,
});
export type InviteRequest = z.infer<typeof inviteRequestSchema>;

export const revokeRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type RevokeRequest = z.infer<typeof revokeRequestSchema>;

export interface MeResponse {
  userId: string;
  email: string;
  name: string;
  restaurantId: string;
  role: z.infer<typeof roleSchema>;
  capabilities: string[];
}
