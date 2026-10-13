import type { Db } from '../lib/db.js';
import { bucket } from '../lib/hash.js';

export interface FlagRow {
  key: string;
  enabled: boolean;
  rollout_percent: number;
  respect_holdout: boolean;
  description: string;
}
export interface ExperimentRow {
  key: string;
  active: boolean;
  variants: { name: string; weight: number }[];
  metric: string;
  description: string;
}
export interface Assignments {
  holdout: boolean;
  flags: Record<string, boolean>;
  experiments: Record<string, string>;
}

export function inHoldout(userId: string, holdoutPercent: number): boolean {
  return bucket('global-holdout', userId) < holdoutPercent * 100;
}

export function flagOn(flag: FlagRow, userId: string, holdout: boolean): boolean {
  if (!flag.enabled) return false;
  if (holdout && flag.respect_holdout) return false;
  return bucket(`flag:${flag.key}`, userId) < flag.rollout_percent * 100;
}

/** Weighted, deterministic variant pick. Holdout users always get the first variant (control). */
export function variantFor(exp: ExperimentRow, userId: string, holdout: boolean): string {
  const control = exp.variants[0]?.name ?? 'control';
  if (!exp.active || holdout) return control;
  const total = exp.variants.reduce((s, v) => s + v.weight, 0);
  if (total <= 0) return control;
  const b = (bucket(`exp:${exp.key}`, userId) / 10000) * total;
  let acc = 0;
  for (const v of exp.variants) {
    acc += v.weight;
    if (b < acc) return v.name;
  }
  return control;
}

/** Small in-process cache so we don't hit Postgres for flags on every request. */
export class FlagService {
  private cache?: { at: number; flags: FlagRow[]; exps: ExperimentRow[]; holdout: number };
  constructor(
    private db: Db,
    private ttlMs = 5000,
  ) {}

  invalidate() {
    this.cache = undefined;
  }

  private async load() {
    if (this.cache && Date.now() - this.cache.at < this.ttlMs) return this.cache;
    const [flags, exps, holdout] = await Promise.all([
      this.db.query<FlagRow>('SELECT key, enabled, rollout_percent, respect_holdout, description FROM feature_flags'),
      this.db.query<ExperimentRow>('SELECT key, active, variants, metric, description FROM experiments'),
      this.db.query("SELECT value FROM schema_settings WHERE key = 'holdout_percent'"),
    ]);
    this.cache = { at: Date.now(), flags: flags.rows, exps: exps.rows, holdout: Number(holdout.rows[0]?.value ?? 0) };
    return this.cache;
  }

  async assignments(userId: string): Promise<Assignments> {
    const c = await this.load();
    const holdout = inHoldout(userId, c.holdout);
    return {
      holdout,
      flags: Object.fromEntries(c.flags.map((f) => [f.key, flagOn(f, userId, holdout)])),
      experiments: Object.fromEntries(c.exps.map((e) => [e.key, variantFor(e, userId, holdout)])),
    };
  }

  async isOn(key: string, userId: string): Promise<boolean> {
    return (await this.assignments(userId)).flags[key] ?? false;
  }
}
