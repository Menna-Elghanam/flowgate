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

export type Config = z.infer<typeof configSchema>;

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
  const parsed = configSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${problems.join('\n')}`);
  }
  cached = parsed.data;
  return cached;
}

export const CONFIG = Symbol('CONFIG');
