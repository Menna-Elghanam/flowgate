import { Body, Controller, Get, HttpCode, Inject, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser, Public, SESSION_COOKIE, type SessionUser } from '../../core/auth/context';
import { CONFIG, loadConfig, type Config } from '../../core/config';
import { ZodPipe } from '../../core/zod-pipe';
import { loginSchema, signupSchema, type LoginInput, type SignupInput } from './auth.schemas';
import { AuthService, type IssuedSession } from './auth.service';

/** Stricter limit on endpoints that check passwords, against credential stuffing. */
export const authThrottle = () =>
  Throttle({ default: { limit: loadConfig().AUTH_RATE_LIMIT, ttl: 60_000 } });

export function setSessionCookie(res: Response, config: Config, session: IssuedSession): void {
  res.cookie(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.COOKIE_SECURE,
    expires: session.expiresAt,
    path: '/',
  });
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  @Public()
  @authThrottle()
  @Post('signup')
  async signup(
    @Body(new ZodPipe(signupSchema)) body: SignupInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.signup(body);
    setSessionCookie(res, this.config, session);
    return { user: session.user, orgId: session.orgId };
  }

  @Public()
  @authThrottle()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginSchema)) body: LoginInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.login(body);
    setSessionCookie(res, this.config, session);
    return { user: session.user };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: SessionUser, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Get('me')
  me(@CurrentUser() user: SessionUser) {
    return this.auth.me(user);
  }
}
