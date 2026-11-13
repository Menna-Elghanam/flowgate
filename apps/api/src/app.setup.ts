import { Logger, type INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import type { ServerOptions } from 'socket.io';
import type { Config } from './core/config';
import type { AppRequest } from './core/auth/context';

class CorsIoAdapter extends IoAdapter {
  constructor(
    app: INestApplication,
    private readonly origin: string,
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): unknown {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.origin, credentials: true },
    });
  }
}

const httpLogger = new Logger('HTTP');

/**
 * An invite link's token is the secret that lets someone join an organization, and it is
 * part of the URL. Logs are read by more people and tools than the database, so it never
 * goes there.
 */
export function redactUrl(url: string): string {
  return url.replace(/\/invites\/[^/?#]+/g, '/invites/[redacted]');
}

function logRequests(req: Request, res: Response, next: NextFunction): void {
  const started = performance.now();
  res.on('finish', () => {
    const ms = Math.round(performance.now() - started);
    const user = (req as AppRequest).user?.id ?? '-';
    const url = redactUrl(req.originalUrl);
    httpLogger.log(`${req.method} ${url} ${res.statusCode} ${ms}ms user=${user}`);
  });
  next();
}

/** Shared by `main.ts` and the API tests, so tests run the same middleware as production. */
export function configureApp(app: NestExpressApplication, config: Config): void {
  // The web app proxies API calls; trust its X-Forwarded-For so rate limits see real client IPs.
  app.set('trust proxy', 'loopback');
  app.use(helmet());
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '1mb' });
  app.enableCors({ origin: config.WEB_ORIGIN, credentials: true });
  app.useWebSocketAdapter(new CorsIoAdapter(app, config.WEB_ORIGIN));
  if (config.NODE_ENV !== 'test') app.use(logRequests);
  app.enableShutdownHooks();
}
