import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq, gt } from 'drizzle-orm';
import { hashToken } from '../../modules/auth/password';
import { DB, type Db } from '../db/db.module';
import { sessions, users } from '../db/schema';
import { AppError } from '../errors';
import { IS_PUBLIC, SESSION_COOKIE, type AppRequest, type SessionUser } from './context';

export async function findSessionUser(
  db: Db,
  token: string | undefined,
): Promise<SessionUser | null> {
  if (!token) return null;
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name, sessionId: sessions.id })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

/** Global guard: every route needs a valid session cookie unless marked `@Public()`. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<AppRequest>();
    const token = (request.cookies as Record<string, string | undefined>)[SESSION_COOKIE];
    const user = await findSessionUser(this.db, token);
    if (user) request.user = user;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Please log in');
    return true;
  }
}
