import type { RequestStatus, TaskStatus } from '@flowgate/workflow';

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  in_progress: 'In progress',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Withdrawn',
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pending: 'Waiting',
  approved: 'Approved',
  rejected: 'Rejected',
  sent_back: 'Sent back',
  skipped: 'Not needed',
  escalated: 'Escalated',
};

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export const STATUS_TONE: Record<RequestStatus | TaskStatus, Tone> = {
  in_progress: 'info',
  pending: 'info',
  changes_requested: 'warning',
  sent_back: 'warning',
  escalated: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
  skipped: 'neutral',
};

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatDate = (iso: string) => dateOnly.format(new Date(`${iso}T00:00:00`));

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === 'minute') return rtf.format(Math.round(diff / ms), unit);
  }
  return '';
}

export const isOverdue = (dueAt: string | null, now = Date.now()) =>
  dueAt !== null && new Date(dueAt).getTime() < now;

/** Human wording for audit actions, used in timelines and the audit log. */
export const ACTION_LABEL: Record<string, string> = {
  organization_created: 'created the organization',
  member_invited: 'invited a member',
  member_joined: 'joined',
  member_updated: 'updated a member',
  member_removed: 'removed a member',
  workflow_created: 'created the workflow',
  workflow_published: 'published the workflow',
  request_submitted: 'submitted the request',
  request_resubmitted: 'resubmitted with changes',
  step_started: 'step started',
  step_completed: 'step completed',
  task_approved: 'approved',
  task_rejected: 'rejected',
  task_sent_back: 'sent it back',
  task_escalated: 'deadline passed: escalated',
  escalation_skipped: 'deadline passed: nobody to escalate to',
  request_sent_back: 'changes requested',
  request_approved: 'request approved',
  request_rejected: 'request rejected',
  request_cancelled: 'withdrew the request',
};

export const actionLabel = (action: string) => ACTION_LABEL[action] ?? action.replace(/_/g, ' ');
