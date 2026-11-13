// Tests use their own database and Redis database index, never development data.
// CI can override any of these through real environment variables.
const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://flowgate:flowgate@localhost:5441/flowgate_test',
  REDIS_URL: 'redis://localhost:6380/1',
  WEB_ORIGIN: 'http://localhost:3000',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1026',
  MAIL_FROM: 'Flowgate <no-reply@flowgate.local>',
  RUN_WORKER: 'false',
  AUTH_RATE_LIMIT: '1000',
};
for (const [key, value] of Object.entries(defaults)) {
  process.env[key] = process.env[`TEST_${key}`] ?? value;
}
