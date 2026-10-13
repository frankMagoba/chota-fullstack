import { randomBytes } from 'node:crypto';
import { withTx } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import type { Ctx } from './context.js';
import { track } from './analytics.js';

const MAX_PENDING_INVITES = 20;
// No 0/O/1/I so codes read out loud over the phone don't get mixed up.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newInviteCode(): string {
  const bytes = randomBytes(6);
  return 'CH' + Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export async function loginOrRegister(ctx: Ctx, phone: string, name: string | undefined, inviteCode?: string) {
  const found = await ctx.db.query('SELECT id, role FROM users WHERE phone = $1', [phone]);
  if (found.rows[0]) return { ...found.rows[0], created: false };

  const user = await withTx(ctx.db, async (tx) => {
    let inviterId: string | null = null;
    if (inviteCode) {
      const inv = await tx.query('SELECT id, role FROM users WHERE invite_code = $1', [inviteCode.trim().toUpperCase()]);
      if (!inv.rows[0]) throw new AppError(400, 'BAD_INVITE', 'That invite code does not exist');
      const pending = await tx.query(`SELECT count(*)::int AS n FROM referrals WHERE inviter_id = $1 AND status = 'pending'`, [
        inv.rows[0].id,
      ]);
      if (pending.rows[0].n >= MAX_PENDING_INVITES)
        throw new AppError(429, 'INVITE_LIMIT', 'This invite code has reached its limit');
      inviterId = inv.rows[0].id;
    }
    const ins = await tx.query(
      `INSERT INTO users (phone, name, invite_code, invited_by) VALUES ($1, $2, $3, $4) RETURNING id, role`,
      [phone, name ?? 'Chota customer', newInviteCode(), inviterId],
    );
    if (inviterId) {
      await tx.query('INSERT INTO referrals (inviter_id, invitee_id) VALUES ($1, $2)', [inviterId, ins.rows[0].id]);
    }
    return { ...ins.rows[0], inviterId };
  });
  if (user.inviterId) await track(ctx.db, ctx.flags, user.id, 'invite_redeemed', { inviterId: user.inviterId });
  return { id: user.id, role: user.role, created: true };
}

/** Lets an existing user attach an invite code later, once, before their first booking. */
export async function redeemInvite(ctx: Ctx, userId: string, code: string) {
  await withTx(ctx.db, async (tx) => {
    const me = await tx.query(
      `SELECT invited_by, (SELECT count(*) FROM bookings WHERE customer_id = $1)::int AS bookings FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    if (me.rows[0].invited_by) throw new AppError(409, 'ALREADY_INVITED', 'You already used an invite code');
    if (me.rows[0].bookings > 0) throw new AppError(409, 'TOO_LATE', 'Invite codes only work before your first order');
    const inv = await tx.query('SELECT id FROM users WHERE invite_code = $1', [code.trim().toUpperCase()]);
    if (!inv.rows[0]) throw new AppError(400, 'BAD_INVITE', 'That invite code does not exist');
    if (inv.rows[0].id === userId) throw new AppError(400, 'SELF_INVITE', 'You cannot use your own code');
    await tx.query('UPDATE users SET invited_by = $2 WHERE id = $1', [userId, inv.rows[0].id]);
    await tx.query('INSERT INTO referrals (inviter_id, invitee_id) VALUES ($1, $2)', [inv.rows[0].id, userId]);
  });
  await track(ctx.db, ctx.flags, userId, 'invite_redeemed', { code });
}

export async function profile(ctx: Ctx, userId: string) {
  const { rows } = await ctx.db.query(
    `SELECT u.id, u.phone, u.name, u.role, u.invite_code AS "inviteCode", u.trust_score AS "trustScore",
       u.completed_jobs AS "completedJobs", u.rating_count AS "ratingCount",
       CASE WHEN u.rating_count > 0 THEN round(u.rating_sum::numeric / u.rating_count, 2) END AS "avgRating",
       u.credit_kes AS "creditKes",
       (SELECT count(*)::int FROM referrals r WHERE r.inviter_id = u.id) AS "invitesSent",
       (SELECT count(*)::int FROM referrals r WHERE r.inviter_id = u.id AND r.status = 'rewarded') AS "invitesRewarded"
     FROM users u WHERE u.id = $1`,
    [userId],
  );
  return rows[0];
}
