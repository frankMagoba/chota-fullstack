/**
 * Trust score, 0-100. Pure function so it is easy to test and to explain.
 *
 * - 60% rating: Bayesian average with a prior of 5 ratings at 4.0 stars, so one
 *   early 5-star (or 1-star) rating can't swing a new account to the extreme.
 * - 25% reliability: completed / (completed + cancelled), with the same kind of prior.
 * - 15% experience: log scale on completed jobs, saturating at 100 jobs.
 */
export interface TrustInputs {
  ratingSum: number;
  ratingCount: number;
  completedJobs: number;
  cancelledJobs: number;
}

const PRIOR_RATINGS = 5;
const PRIOR_STARS = 4.0;

export function trustScore(i: TrustInputs): number {
  const avgStars = (i.ratingSum + PRIOR_RATINGS * PRIOR_STARS) / (i.ratingCount + PRIOR_RATINGS);
  const ratingPart = ((avgStars - 1) / 4) * 100;
  const reliability = (i.completedJobs + 4) / (i.completedJobs + i.cancelledJobs + 5);
  const experience = Math.min(1, Math.log10(1 + i.completedJobs) / 2);
  const score = 0.6 * ratingPart + 0.25 * reliability * 100 + 0.15 * experience * 100;
  return Math.round(score * 100) / 100;
}

export const TRUST_SQL_RECOMPUTE = `
  UPDATE users SET trust_score = $2 WHERE id = $1
`;
