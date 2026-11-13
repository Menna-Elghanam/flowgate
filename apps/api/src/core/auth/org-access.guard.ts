import type { Role } from '@flowgate/workflow';
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module';
import { memberships } from '../db/schema';
import { forbidden, notFound } from '../errors';
import { REQUIRED_ROLES, type AppRequest } from './context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * For routes under `/orgs/:orgId`: loads the caller's membership and checks `@Roles(...)`.
 * Non-members get 404, not 403, so the API never confirms that another organization exists.
 */
@Injectable()
export class OrgAccessGuard implements CanActivate {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AppRequest>();
    const param: unknown = request.params.orgId;
    const orgId = typeof param === 'string' && UUID.test(param) ? param : null;
    const user = request.user;
    if (!user || !orgId) throw notFound('Organization');

    const [member] = await this.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, user.id)))
      .limit(1);
    if (!member) throw notFound('Organization');

    request.member = {
      orgId,
      userId: user.id,
      roles: member.roles,
      managerId: member.managerId,
    };

    const required = this.reflector.getAllAndOverride<Role[] | undefined>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required && !required.some((role) => member.roles.includes(role))) {
      throw forbidden(`This needs the ${required.join(' or ')} role`);
    }
    return true;
  }
}
