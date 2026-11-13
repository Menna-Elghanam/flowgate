import type { Assignee } from '@flowgate/workflow';
import { eq } from 'drizzle-orm';
import type { Executor } from '../core/db/db.module';
import { memberships } from '../core/db/schema';

interface MemberInfo {
  userId: string;
  roles: string[];
  managerId: string | null;
}

async function loadMembers(db: Executor, orgId: string): Promise<Map<string, MemberInfo>> {
  const rows = await db
    .select({
      userId: memberships.userId,
      roles: memberships.roles,
      managerId: memberships.managerId,
    })
    .from(memberships)
    .where(eq(memberships.orgId, orgId));
  return new Map(rows.map((row) => [row.userId, row]));
}

const admins = (members: Map<string, MemberInfo>, exclude: ReadonlySet<string>) =>
  [...members.values()]
    .filter((m) => m.roles.includes('admin') && !exclude.has(m.userId))
    .map((m) => m.userId);

export interface ResolvedAssignees {
  userIds: string[];
  /** True when separation of duties or a missing assignee forced a substitute. */
  substituted: boolean;
}

/**
 * Turns a step's assignee rule into concrete people, applying separation of duties
 * (ADR 0002, rule 4): the requester never approves their own request. Their place goes to
 * their manager; with no manager, to the admins. Only current members are ever assigned.
 */
export async function resolveAssignees(
  db: Executor,
  orgId: string,
  requesterId: string,
  assignee: Assignee,
): Promise<ResolvedAssignees> {
  const members = await loadMembers(db, orgId);
  const requester = members.get(requesterId);
  const managerId =
    requester?.managerId && requester.managerId !== requesterId && members.has(requester.managerId)
      ? requester.managerId
      : null;

  let candidates: string[];
  switch (assignee.kind) {
    case 'manager':
      candidates = managerId ? [managerId] : [];
      break;
    case 'users':
      candidates = assignee.userIds.filter((id) => members.has(id));
      break;
    case 'role':
      candidates = [...members.values()]
        .filter((m) => m.roles.includes(assignee.role))
        .map((m) => m.userId);
      break;
  }

  const includedRequester = candidates.includes(requesterId);
  candidates = candidates.filter((id) => id !== requesterId);
  let substituted = false;

  if (includedRequester && managerId && !candidates.includes(managerId)) {
    candidates.push(managerId);
    substituted = true;
  }
  if (candidates.length === 0 && managerId && assignee.kind !== 'manager') {
    candidates = [managerId];
    substituted = true;
  }
  if (candidates.length === 0) {
    candidates = admins(members, new Set([requesterId]));
    substituted = true;
  }
  return { userIds: [...new Set(candidates)], substituted };
}

/** Who takes over an overdue task: the assignee's manager, otherwise the admins. */
export async function escalationTargets(
  db: Executor,
  orgId: string,
  assigneeId: string,
  exclude: ReadonlySet<string>,
): Promise<string[]> {
  const members = await loadMembers(db, orgId);
  const managerId = members.get(assigneeId)?.managerId;
  if (managerId && members.has(managerId) && !exclude.has(managerId)) return [managerId];
  return admins(members, exclude);
}
