import type { Db, Tx } from '../lib/db.js';
import type { FlagService } from './flags.js';

/** Allow-list keeps the event table clean; unknown names are rejected at the API. */
export const EVENT_NAMES = [
  'app_opened',
  'service_selected',
  'quantity_selected',
  'booking_requested',
  'booking_created',
  'booking_no_driver',
  'booking_slot_full',
  'booking_completed',
  'booking_cancelled',
  'rating_submitted',
  'invite_shared',
  'invite_redeemed',
  'referral_rewarded',
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export async function track(
  db: Db | Tx,
  flags: FlagService,
  userId: string | null,
  name: EventName,
  props: Record<string, unknown> = {},
) {
  const assignments = userId ? await flags.assignments(userId) : {};
  await db.query('INSERT INTO analytics_events (user_id, name, props, assignments) VALUES ($1, $2, $3, $4)', [
    userId,
    name,
    props,
    assignments,
  ]);
}
