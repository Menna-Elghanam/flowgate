import { parseConfig } from './config';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  WEB_ORIGIN: 'https://flowgate.example',
  SMTP_HOST: 'smtp.example',
  SMTP_PORT: '587',
  MAIL_FROM: 'Flowgate <no-reply@flowgate.example>',
};

describe('parseConfig', () => {
  it('refuses to start in production without secure cookies', () => {
    expect(() => parseConfig({ ...base, NODE_ENV: 'production' })).toThrow(
      /COOKIE_SECURE: must be true in production/,
    );
    expect(() => parseConfig({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'false' })).toThrow(
      /COOKIE_SECURE/,
    );
  });

  it('starts in production with secure cookies', () => {
    const config = parseConfig({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'true' });
    expect(config.COOKIE_SECURE).toBe(true);
  });

  it('allows plain HTTP cookies in development', () => {
    expect(parseConfig({ ...base, NODE_ENV: 'development' }).COOKIE_SECURE).toBe(false);
  });
});
