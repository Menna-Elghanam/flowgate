import { z } from 'zod';

const booleanFromString = z.enum(['true', 'false']).transform((value) => value === 'true');

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  WEB_ORIGIN: z.string().url(),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  MAIL_FROM: z.string().min(3),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  COOKIE_SECURE: booleanFromString.default('false'),
  RUN_WORKER: booleanFromString.default('true'),
  SWEEP_INTERVAL_MS: z.coerce.number().int().min(1000).default(60_000),
  AUTH_RATE_LIMIT: z.coerce.number().int().min(1).default(10),
});
// Without Secure, the browser would also send the session cookie over plain HTTP. Easy to
// forget when deploying, so production refuses to start instead.
const checkedConfigSchema = configSchema.refine(
  (config) => config.NODE_ENV !== 'production' || config.COOKIE_SECURE,
  { path: ['COOKIE_SECURE'], message: 'must be true in production (sessions need HTTPS)' },
);

export type Config = z.infer<typeof configSchema>;

export function parseConfig(env: Record<string, string | undefined>): Config {
  const parsed = checkedConfigSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${problems.join('\n')}`);
  }
  return parsed.data;
}

let cached: Config | undefined;

/**
 * Reads and validates environment variables once. The app refuses to start with a clear
 * message instead of failing later on a missing or malformed value.
 */
export function loadConfig(): Config {
  if (cached) return cached;
  try {
    process.loadEnvFile('.env');
  } catch {
    // No .env file: rely on real environment variables (CI, containers).
  }
  cached = parseConfig(process.env);
  return cached;
}

export const CONFIG = Symbol('CONFIG');
