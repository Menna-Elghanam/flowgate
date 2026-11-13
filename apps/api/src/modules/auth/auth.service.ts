import { Inject, Injectable } from '@nestjs/common';
import { Clock } from '../../core/clock';
import type { SessionUser } from '../../core/auth/context';
import { CONFIG, type Config } from '../../core/config';
import { DB, type Db, type Executor } from '../../core/db/db.module';
import { recordAudit } from '../../core/db/audit';
import { AppError } from '../../core/errors';
import { AuthRepository } from './auth.repository';
import type { LoginInput, SignupInput } from './auth.schemas';
import { hashPassword, newToken, verifyPassword } from './password';

export interface IssuedSession {
  token: string;
  expiresAt: Date;
  user: { id: string; email: string; name: string };
}

// Verifying against a real hash when the email is unknown keeps the response time the
// same, so login timing can't reveal which emails have accounts.
const DUMMY_HASH = hashPassword('not-a-real-password');

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    private readonly repo: AuthRepository,
    private readonly clock: Clock,
  ) {}

  async signup(input: SignupInput): Promise<IssuedSession & { orgId: string }> {
    if (await this.repo.findUserByEmail(input.email)) {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
    }
    const passwordHash = await hashPassword(input.password);
    return this.db.transaction(async (tx) => {
      const user = await this.repo.createUser(tx, {
        email: input.email,
        name: input.name,
        passwordHash,
      });
      const org = await this.repo.createOrganization(tx, input.organizationName);
      // The creator does everything at first; they can hand out roles later.
      await this.repo.addMembership(tx, {
        orgId: org.id,
        userId: user.id,
        roles: ['admin', 'approver', 'employee'],
      });
      await recordAudit(tx, {
        orgId: org.id,
        actorId: user.id,
        action: 'organization_created',
        details: { name: org.name },
        createdAt: this.clock.now(),
      });
      const session = await this.issueSession(tx, user);
      return { ...session, orgId: org.id };
    });
  }

  async login(input: LoginInput): Promise<IssuedSession> {
    const user = await this.repo.findUserByEmail(input.email);
    const valid = await verifyPassword(input.password, user?.passwordHash ?? (await DUMMY_HASH));
    if (!user || !valid) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    }
    return this.issueSession(this.db, user);
  }

  /** Used by invite acceptance: an existing account proves it's theirs with the password. */
  async verifyExistingUser(email: string, password: string) {
    const user = await this.repo.findUserByEmail(email);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Password is incorrect for this account');
    }
    return user;
  }

  async issueSession(
    db: Executor,
    user: { id: string; email: string; name: string },
  ): Promise<IssuedSession> {
    const { token, hash } = newToken();
    const expiresAt = new Date(Date.now() + this.config.SESSION_TTL_DAYS * 86_400_000);
    await this.repo.createSession(db, user.id, hash, expiresAt);
    return { token, expiresAt, user: { id: user.id, email: user.email, name: user.name } };
  }

  logout(user: SessionUser) {
    return this.repo.deleteSession(user.sessionId);
  }

  async me(user: SessionUser) {
    const organizations = await this.repo.listOrganizations(user.id);
    return { user: { id: user.id, email: user.email, name: user.name }, organizations };
  }
}
