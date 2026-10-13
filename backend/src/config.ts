function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var ${name}`);
  return v;
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required('DATABASE_URL', 'postgres://chota:chota@localhost:5432/chota'),
  redisUrl: required('REDIS_URL', 'redis://localhost:6379'),
  // Dev default only. Production must set JWT_SECRET.
  jwtSecret: isProd ? required('JWT_SECRET') : required('JWT_SECRET', 'dev-only-not-a-secret'),
  dispatchRadiusKm: Number(process.env.DISPATCH_RADIUS_KM ?? 8),
  referralRewardKes: Number(process.env.REFERRAL_REWARD_KES ?? 200),
  llm: {
    apiKey: process.env.LLM_API_KEY ?? '',
    baseUrl: process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
    model: process.env.LLM_MODEL ?? 'gpt-4o-mini',
  },
};
