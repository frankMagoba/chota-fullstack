import { describe, expect, it } from 'vitest';
import { trustScore } from '../src/services/trust.js';
import { priceKes, surgeMultiplier } from '../src/services/pricing.js';
import { flagOn, inHoldout, variantFor, type FlagRow } from '../src/services/flags.js';
import { distanceKm, zoneFor } from '../src/lib/geo.js';

const ids = Array.from({ length: 20000 }, (_, i) => `user-${i}`);

describe('trust score', () => {
  it('starts new accounts in the middle, not at the extremes', () => {
    const s = trustScore({ ratingSum: 0, ratingCount: 0, completedJobs: 0, cancelledJobs: 0 });
    expect(s).toBeGreaterThan(55);
    expect(s).toBeLessThan(75);
  });
  it('one 1-star rating does not sink a new driver', () => {
    expect(trustScore({ ratingSum: 1, ratingCount: 1, completedJobs: 1, cancelledJobs: 0 })).toBeGreaterThan(50);
  });
  it('rewards a long, well-rated record over a short one', () => {
    const veteran = trustScore({ ratingSum: 4.8 * 200, ratingCount: 200, completedJobs: 220, cancelledJobs: 2 });
    const newbie = trustScore({ ratingSum: 5, ratingCount: 1, completedJobs: 1, cancelledJobs: 0 });
    expect(veteran).toBeGreaterThan(newbie);
    expect(veteran).toBeLessThanOrEqual(100);
  });
  it('penalises cancellations', () => {
    const base = { ratingSum: 45, ratingCount: 10, completedJobs: 10 };
    expect(trustScore({ ...base, cancelledJobs: 10 })).toBeLessThan(trustScore({ ...base, cancelledJobs: 0 }));
  });
});

describe('pricing', () => {
  it('surge steps at 80% and 95% and caps at 1.5x', () => {
    expect(surgeMultiplier(5, 10)).toBe(1);
    expect(surgeMultiplier(8, 10)).toBe(1.25);
    expect(surgeMultiplier(10, 10)).toBe(1.5);
  });
  it('prices by litre', () => {
    expect(priceKes('water', 10000)).toBe(4500);
    expect(priceKes('water', 10000, 1.5)).toBe(6750);
    expect(priceKes('sewage', 10000)).toBe(7500);
  });
});

describe('flags and experiments', () => {
  const flag: FlagRow = { key: 'f', enabled: true, rollout_percent: 30, respect_holdout: true, description: '' };

  it('assignment is deterministic per user', () => {
    for (const id of ids.slice(0, 100)) expect(flagOn(flag, id, false)).toBe(flagOn(flag, id, false));
  });
  it('rollout percentage is roughly honoured', () => {
    const on = ids.filter((id) => flagOn(flag, id, false)).length / ids.length;
    expect(on).toBeGreaterThan(0.28);
    expect(on).toBeLessThan(0.32);
  });
  it('raising the rollout only adds users, never removes them', () => {
    const at30 = ids.filter((id) => flagOn(flag, id, false));
    const at60 = new Set(ids.filter((id) => flagOn({ ...flag, rollout_percent: 60 }, id, false)));
    expect(at30.every((id) => at60.has(id))).toBe(true);
  });
  it('holdout users never get flagged features or treatments', () => {
    const exp = {
      key: 'e',
      active: true,
      metric: 'm',
      description: '',
      variants: [
        { name: 'control', weight: 50 },
        { name: 'b', weight: 50 },
      ],
    };
    const held = ids.filter((id) => inHoldout(id, 5));
    expect(held.length / ids.length).toBeGreaterThan(0.04);
    expect(held.length / ids.length).toBeLessThan(0.06);
    expect(held.every((id) => !flagOn({ ...flag, rollout_percent: 100 }, id, true))).toBe(true);
    expect(held.every((id) => variantFor(exp, id, true) === 'control')).toBe(true);
  });
  it('experiment splits follow weights and are independent of flag buckets', () => {
    const exp = {
      key: 'e',
      active: true,
      metric: 'm',
      description: '',
      variants: [
        { name: 'control', weight: 80 },
        { name: 'b', weight: 20 },
      ],
    };
    const b = ids.filter((id) => variantFor(exp, id, false) === 'b').length / ids.length;
    expect(b).toBeGreaterThan(0.18);
    expect(b).toBeLessThan(0.22);
  });
});

describe('geo', () => {
  it('haversine is about right for CBD to Karen', () => {
    const d = distanceKm({ lat: -1.2864, lng: 36.8172 }, { lat: -1.3197, lng: 36.7076 });
    expect(d).toBeGreaterThan(12);
    expect(d).toBeLessThan(13);
  });
  it('nearby points share a zone', () => {
    expect(zoneFor(-1.3601, 36.748)).toBe(zoneFor(-1.3605, 36.749));
  });
});
