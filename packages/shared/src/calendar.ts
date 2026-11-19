import { z } from 'zod';
import type { CHANNELS } from './assistant.js';
import type { PostStatus } from './content.js';

export interface NotificationView {
  id: string;
  kind: 'post_due' | 'post_overdue' | 'post_not_submitted' | 'approval_waiting' | 'fact_expiring' | 'fact_expired';
  title: string;
  body: string;
  /** In-app path. */
  link: string;
  createdAt: string;
  read: boolean;
}

export interface NotificationsResponse {
  notifications: NotificationView[];
  unread: number;
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const calendarQuerySchema = z
  .object({ from: day, to: day })
  .refine((q) => q.from <= q.to, 'from must be before to')
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 <= 92, 'At most about three months at a time');

export interface CalendarPost {
  itemId: string;
  title: string;
  status: PostStatus;
  channel: (typeof CHANNELS)[number];
  scheduledFor: string;
}

export interface CalendarFact {
  itemId: string;
  title: string;
  expiresAt: string;
}

export interface CalendarResponse {
  posts: CalendarPost[];
  facts: CalendarFact[];
  /** Posts without a date, so nothing is forgotten. */
  unscheduled: { itemId: string; title: string; status: PostStatus }[];
}
