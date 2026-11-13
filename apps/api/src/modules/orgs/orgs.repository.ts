import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DB, type Db, type Executor } from '../../core/db/db.module';
import { invites, memberships, organizations, users } from '../../core/db/schema';

const managers = alias(users, 'managers');

@Injectable()
export class OrgsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findOrganization(orgId: string) {
    const [org] = await this.db.select().from(organizations).where(eq(organizations.id, orgId));
    return org;
  }

  listMembers(orgId: string) {
    return this.db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        roles: memberships.roles,
        managerId: memberships.managerId,
        managerName: managers.name,
        joinedAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .leftJoin(managers, eq(managers.id, memberships.managerId))
      .where(eq(memberships.orgId, orgId))
      .orderBy(asc(users.name));
  }

  /**
   * Locks every membership row of the organization. Role changes and removals take this
   * lock so two admins can't remove each other at the same moment and leave no admin.
   */
  lockMembers(tx: Executor, orgId: string) {
    return tx
      .select({
        userId: memberships.userId,
        roles: memberships.roles,
        managerId: memberships.managerId,
      })
      .from(memberships)
      .where(eq(memberships.orgId, orgId))
      .for('update');
  }

  async updateMember(
    tx: Executor,
    orgId: string,
    userId: string,
    patch: Partial<typeof memberships.$inferInsert>,
  ) {
    await tx
      .update(memberships)
      .set(patch)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
  }

  async removeMember(tx: Executor, orgId: string, userId: string) {
    await tx
      .update(memberships)
      .set({ managerId: null })
      .where(and(eq(memberships.orgId, orgId), eq(memberships.managerId, userId)));
    await tx
      .update(invites)
      .set({ managerId: null })
      .where(and(eq(invites.orgId, orgId), eq(invites.managerId, userId)));
    await tx
      .delete(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
  }

  listPendingInvites(orgId: string, now: Date) {
    return this.db
      .select({
        id: invites.id,
        email: invites.email,
        roles: invites.roles,
        managerId: invites.managerId,
        expiresAt: invites.expiresAt,
        createdAt: invites.createdAt,
      })
      .from(invites)
      .where(
        and(
          eq(invites.orgId, orgId),
          isNull(invites.acceptedAt),
          isNull(invites.revokedAt),
          gt(invites.expiresAt, now),
        ),
      )
      .orderBy(asc(invites.createdAt));
  }

  async isMemberByEmail(orgId: string, email: string) {
    const [row] = await this.db
      .select({ one: sql<number>`1` })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.orgId, orgId), eq(users.email, email)));
    return Boolean(row);
  }

  async isMember(orgId: string, userId: string, db: Executor = this.db) {
    const [row] = await db
      .select({ one: sql<number>`1` })
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
    return Boolean(row);
  }

  async revokePendingInvitesFor(tx: Executor, orgId: string, email: string, now: Date) {
    await tx
      .update(invites)
      .set({ revokedAt: now })
      .where(
        and(
          eq(invites.orgId, orgId),
          eq(invites.email, email),
          isNull(invites.acceptedAt),
          isNull(invites.revokedAt),
        ),
      );
  }

  async createInvite(tx: Executor, values: typeof invites.$inferInsert) {
    const [invite] = await tx.insert(invites).values(values).returning();
    if (!invite) throw new Error('Insert returned no row');
    return invite;
  }

  async revokeInvite(orgId: string, inviteId: string, now: Date) {
    const rows = await this.db
      .update(invites)
      .set({ revokedAt: now })
      .where(
        and(
          eq(invites.id, inviteId),
          eq(invites.orgId, orgId),
          isNull(invites.acceptedAt),
          isNull(invites.revokedAt),
        ),
      )
      .returning({ id: invites.id });
    return rows.length > 0;
  }

  /** Pass a transaction to read the invite with a row lock. */
  async findInviteByTokenHash(tokenHash: string, tx?: Executor) {
    const query = (tx ?? this.db)
      .select({ invite: invites, orgName: organizations.name })
      .from(invites)
      .innerJoin(organizations, eq(organizations.id, invites.orgId))
      .where(eq(invites.tokenHash, tokenHash));
    const [row] = tx ? await query.for('update', { of: invites }) : await query;
    return row;
  }

  async markInviteAccepted(tx: Executor, inviteId: string, now: Date) {
    await tx.update(invites).set({ acceptedAt: now }).where(eq(invites.id, inviteId));
  }
}
