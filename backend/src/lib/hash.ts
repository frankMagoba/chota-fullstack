import { createHash } from 'node:crypto';

/** Deterministic bucket in [0, 10000) for a (salt, userId) pair. */
export function bucket(salt: string, userId: string): number {
  const h = createHash('sha256').update(`${salt}:${userId}`).digest();
  return h.readUInt32BE(0) % 10000;
}
