import { Inject, Injectable } from '@nestjs/common';
import type { OrgMember, SessionUser } from '../../core/auth/context';
import { addHours, Clock } from '../../core/clock';
import { CONFIG, type Config } from '../../core/config';
import { recordAudit } from '../../core/db/audit';
import { UnitOfWork } from '../../core/effects/unit-of-work';
import { AppError, conflict, notFound } from '../../core/errors';
import { EngineService } from '../../engine/engine.service';
import { AuthRepository } from '../auth/auth.repository';
import { AuthService } from '../auth/auth.service';
import { hashPassword, hashToken, newToken } from '../auth/password';
import type { AcceptInviteInput, CreateInviteInput, UpdateMemberInput } from './orgs.schemas';
import { OrgsRepository } from './orgs.repository';

const INVITE_TTL_HOURS = 7 * 24;

type LockedMember = { userId: string; roles: string[]; managerId: string | null };

/** Walks up the manager chain; a loop would make "manager of the manager" never end. */
function createsManagerLoop(members: LockedMember[], userId: string, managerId: string): boolean {
  const managerOf = new Map(members.map((m) => [m.userId, m.managerId]));
  let current: string | null | undefined = managerId;
  for (let hops = 0; current && hops <= members.length; hops++) {
    if (current === userId) return true;
    current = managerOf.get(current);
  }
  return false;
}

@Injectable()
export class OrgsService {
  constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly repo: OrgsRepository,
    private readonly authRepo: AuthRepository,
    private readonly auth: AuthService,
    private readonly engine: EngineService,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async getOrganization(member: OrgMember) {
    const org = await this.repo.findOrganization(member.orgId);
    if (!org) throw notFound('Organization');
    return { id: org.id, name: org.name, myRoles: member.roles };
  }

  listMembers(member: OrgMember) {
    return this.repo.listMembers(member.orgId);
  }

  updateMember(admin: OrgMember, userId: string, input: UpdateMemberInput) {
    return this.uow.run(async (tx) => {
      const members = await this.repo.lockMembers(tx, admin.orgId);
      const target = members.find((m) => m.userId === userId);
      if (!target) throw notFound('Member');

      if (input.roles && target.roles.includes('admin') && !input.roles.includes('admin')) {
        const admins = members.filter((m) => m.roles.includes('admin'));
        if (admins.length === 1) {
          throw conflict('LAST_ADMIN', 'The organization needs at least one admin');
        }
      }
      if (input.managerId) {
        if (input.managerId === userId) {
          throw new AppError(422, 'INVALID_MANAGER', "Someone can't be their own manager");
        }
        if (!members.some((m) => m.userId === input.managerId)) {
          throw new AppError(
            422,
            'INVALID_MANAGER',
            'The manager must be a member of the organization',
          );
        }
        if (createsManagerLoop(members, userId, input.managerId)) {
          throw new AppError(
            422,
            'INVALID_MANAGER',
            'This would create a loop in the manager chain',
          );
        }
      }

      const patch = {
        ...(input.roles ? { roles: input.roles } : {}),
        ...(input.managerId !== undefined ? { managerId: input.managerId } : {}),
      };
      await this.repo.updateMember(tx, admin.orgId, userId, patch);
      await recordAudit(tx, {
        orgId: admin.orgId,
        actorId: admin.userId,
        action: 'member_updated',
        details: { userId, ...patch },
        createdAt: this.clock.now(),
      });
      return { userId, ...patch };
    });
  }

  removeMember(admin: OrgMember, userId: string) {
    return this.uow.run(async (tx, fx) => {
      const members = await this.repo.lockMembers(tx, admin.orgId);
      const target = members.find((m) => m.userId === userId);
      if (!target) throw notFound('Member');
      if (
        target.roles.includes('admin') &&
        members.filter((m) => m.roles.includes('admin')).length === 1
      ) {
        throw conflict('LAST_ADMIN', 'The organization needs at least one admin');
      }
      // Their open approvals must not get stuck: hand them over before the membership goes.
      await this.engine.handOverTasksOfRemovedMember(tx, fx, admin.orgId, userId, admin.userId);
      await this.repo.removeMember(tx, admin.orgId, userId);
      await recordAudit(tx, {
        orgId: admin.orgId,
        actorId: admin.userId,
        action: 'member_removed',
        details: { userId },
        createdAt: this.clock.now(),
      });
    });
  }

  listInvites(admin: OrgMember) {
    return this.repo.listPendingInvites(admin.orgId, this.clock.now());
  }

  async createInvite(admin: OrgMember, inviter: SessionUser, input: CreateInviteInput) {
    if (await this.repo.isMemberByEmail(admin.orgId, input.email)) {
      throw conflict('ALREADY_MEMBER', 'This person is already a member');
    }
    if (input.managerId && !(await this.repo.isMember(admin.orgId, input.managerId))) {
      throw new AppError(
        422,
        'INVALID_MANAGER',
        'The manager must be a member of the organization',
      );
    }
    const org = await this.repo.findOrganization(admin.orgId);
    if (!org) throw notFound('Organization');

    const { token, hash } = newToken();
    const now = this.clock.now();
    const link = `${this.config.WEB_ORIGIN}/invite/${token}`;
    const invite = await this.uow.run(async (tx, fx) => {
      // A new invite replaces older open ones for the same email.
      await this.repo.revokePendingInvitesFor(tx, admin.orgId, input.email, now);
      const created = await this.repo.createInvite(tx, {
        orgId: admin.orgId,
        email: input.email,
        roles: input.roles,
        managerId: input.managerId,
        tokenHash: hash,
        invitedBy: admin.userId,
        expiresAt: addHours(now, INVITE_TTL_HOURS),
        createdAt: now,
      });
      await recordAudit(tx, {
        orgId: admin.orgId,
        actorId: admin.userId,
        action: 'member_invited',
        details: { email: input.email, roles: input.roles },
        createdAt: now,
      });
      fx.email({
        template: 'invite',
        toEmail: input.email,
        vars: { orgName: org.name, inviterName: inviter.name, inviteUrl: link },
      });
      return created;
    });
    // The link is shown once to the admin (handy when email isn't set up); only its hash is stored.
    return {
      id: invite.id,
      email: invite.email,
      roles: invite.roles,
      managerId: invite.managerId,
      expiresAt: invite.expiresAt,
      link,
    };
  }

  async revokeInvite(admin: OrgMember, inviteId: string) {
    if (!(await this.repo.revokeInvite(admin.orgId, inviteId, this.clock.now()))) {
      throw notFound('Invite');
    }
  }

  async describeInvite(token: string) {
    const row = await this.repo.findInviteByTokenHash(hashToken(token));
    this.assertUsable(row?.invite);
    if (!row) throw notFound('Invite');
    const existing = await this.authRepo.findUserByEmail(row.invite.email);
    return { orgName: row.orgName, email: row.invite.email, accountExists: Boolean(existing) };
  }

  async acceptInvite(token: string, input: AcceptInviteInput) {
    const preview = await this.repo.findInviteByTokenHash(hashToken(token));
    this.assertUsable(preview?.invite);
    if (!preview) throw notFound('Invite');
    const email = preview.invite.email;

    const existing = await this.authRepo.findUserByEmail(email);
    let newAccount: { email: string; name: string; passwordHash: string } | null = null;
    if (existing) {
      await this.auth.verifyExistingUser(email, input.password);
    } else {
      if (!input.name) throw new AppError(400, 'VALIDATION_ERROR', 'Your name is required');
      if (input.password.length < 8) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Use at least 8 characters for your password');
      }
      newAccount = { email, name: input.name, passwordHash: await hashPassword(input.password) };
    }

    return this.uow.run(async (tx) => {
      // Re-read under a lock so the same link can't be used twice at the same moment.
      const row = await this.repo.findInviteByTokenHash(hashToken(token), tx);
      this.assertUsable(row?.invite);
      if (!row) throw notFound('Invite');
      const { invite } = row;
      const now = this.clock.now();

      const user = newAccount ? await this.authRepo.createUser(tx, newAccount) : existing;
      if (!user) throw new Error('Invite acceptance without a user');
      if (await this.repo.isMember(invite.orgId, user.id, tx)) {
        throw conflict('ALREADY_MEMBER', 'You are already a member of this organization');
      }
      const managerStillThere =
        invite.managerId && (await this.repo.isMember(invite.orgId, invite.managerId, tx));
      await this.authRepo.addMembership(tx, {
        orgId: invite.orgId,
        userId: user.id,
        roles: invite.roles,
        managerId: managerStillThere ? invite.managerId : null,
      });
      await this.repo.markInviteAccepted(tx, invite.id, now);
      await recordAudit(tx, {
        orgId: invite.orgId,
        actorId: user.id,
        action: 'member_joined',
        details: { email, roles: invite.roles },
        createdAt: now,
      });
      const session = await this.auth.issueSession(tx, user);
      return { session, orgId: invite.orgId };
    });
  }

  private assertUsable(
    invite: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date } | undefined,
  ) {
    if (!invite || invite.revokedAt) throw notFound('Invite');
    if (invite.acceptedAt)
      throw new AppError(410, 'INVITE_USED', 'This invite has already been used');
    if (invite.expiresAt <= this.clock.now())
      throw new AppError(410, 'INVITE_EXPIRED', 'This invite has expired');
  }
}
