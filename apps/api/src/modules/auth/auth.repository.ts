import type { Role } from '@flowgate/workflow';
import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DB, type Db, type Executor } from '../../core/db/db.module';
import { memberships, organizations, sessions, users } from '../../core/db/schema';

@Injectable()
export class AuthRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findUserByEmail(email: string, db: Executor = this.db) {
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return user;
  }

  async createUser(db: Executor, values: { email: string; name: string; passwordHash: string }) {
    const [user] = await db.insert(users).values(values).returning();
    if (!user) throw new Error('Insert returned no row');
    return user;
  }

  async createOrganization(db: Executor, name: string) {
    const [org] = await db.insert(organizations).values({ name }).returning();
    if (!org) throw new Error('Insert returned no row');
    return org;
  }

  async addMembership(
    db: Executor,
    values: { orgId: string; userId: string; roles: Role[]; managerId?: string | null },
  ) {
    await db.insert(memberships).values(values);
  }

  async createSession(db: Executor, userId: string, tokenHash: string, expiresAt: Date) {
    await db.insert(sessions).values({ userId, tokenHash, expiresAt });
  }

  async deleteSession(sessionId: string) {
    await this.db.delete(sessions).where(eq(sessions.id, sessionId));
  }

  listOrganizations(userId: string) {
    return this.db
      .select({ id: organizations.id, name: organizations.name, roles: memberships.roles })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(eq(memberships.userId, userId))
      .orderBy(asc(organizations.name));
  }
}
