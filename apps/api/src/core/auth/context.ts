import type { Role } from '@flowgate/workflow';
import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  sessionId: string;
}

export interface OrgMember {
  orgId: string;
  userId: string;
  roles: Role[];
  managerId: string | null;
}

export interface AppRequest extends Request {
  user?: SessionUser;
  member?: OrgMember;
}

export const SESSION_COOKIE = 'fg_session';

export const IS_PUBLIC = 'isPublic';
/** Marks a route that works without a session (sign-up, login, invite links, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const REQUIRED_ROLES = 'requiredRoles';
/** The caller needs at least one of these roles in the organization in the URL. */
export const Roles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES, roles);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): SessionUser => {
    const user = ctx.switchToHttp().getRequest<AppRequest>().user;
    if (!user) throw new Error('CurrentUser used on a route without SessionGuard');
    return user;
  },
);

export const CurrentMember = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): OrgMember => {
    const member = ctx.switchToHttp().getRequest<AppRequest>().member;
    if (!member) throw new Error('CurrentMember used on a route without OrgAccessGuard');
    return member;
  },
);
