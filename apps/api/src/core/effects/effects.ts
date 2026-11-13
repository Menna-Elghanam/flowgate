export type EmailTemplate =
  | 'invite'
  | 'task_assigned'
  | 'task_reminder'
  | 'task_escalated'
  | 'changes_requested'
  | 'request_completed';

export interface EmailJob {
  template: EmailTemplate;
  /** Either a known user (address looked up when sending) or a raw address (invites). */
  toUserId?: string;
  toEmail?: string;
  vars: Record<string, string>;
}

/** Tells these users' browsers that something about a request changed, so they refetch. */
export interface ChangeNotice {
  orgId: string;
  requestId: string | null;
  userIds: string[];
}

/**
 * Side effects collected while a transaction runs. They are delivered only after the
 * transaction commits (see `UnitOfWork`), so nobody is emailed about a change that was
 * rolled back, and a slow mail server never holds a database lock.
 */
export class Effects {
  readonly emails: EmailJob[] = [];
  private readonly notices = new Map<string, ChangeNotice>();

  email(job: EmailJob): void {
    this.emails.push(job);
  }

  notify(orgId: string, requestId: string | null, userIds: Iterable<string>): void {
    const key = `${orgId}:${requestId ?? ''}`;
    const notice = this.notices.get(key) ?? { orgId, requestId, userIds: [] };
    notice.userIds = [...new Set([...notice.userIds, ...userIds])];
    this.notices.set(key, notice);
  }

  get changeNotices(): ChangeNotice[] {
    return [...this.notices.values()];
  }

  get isEmpty(): boolean {
    return this.emails.length === 0 && this.notices.size === 0;
  }
}

/** Delivers effects. Swapped for a recording fake in tests and a no-op in the seed script. */
export abstract class EffectsRunner {
  abstract flush(effects: Effects): Promise<void>;
}
