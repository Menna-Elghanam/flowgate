export const REQUEST_STATUSES = [
  'in_progress',
  'changes_requested',
  'approved',
  'rejected',
  'cancelled',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const TASK_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'sent_back',
  'skipped',
  'escalated',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** The only moves a request can make. Anything else is a bug or a stale action. */
export const REQUEST_TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  in_progress: ['approved', 'rejected', 'changes_requested', 'cancelled'],
  changes_requested: ['in_progress', 'cancelled'],
  approved: [],
  rejected: [],
  cancelled: [],
};

export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ['approved', 'rejected', 'sent_back', 'skipped', 'escalated'],
  approved: [],
  rejected: [],
  sent_back: [],
  skipped: [],
  escalated: [],
};

export const FINAL_REQUEST_STATUSES: readonly RequestStatus[] = [
  'approved',
  'rejected',
  'cancelled',
];

export class InvalidTransitionError extends Error {
  constructor(
    readonly entity: 'request' | 'task',
    readonly from: string,
    readonly to: string,
  ) {
    super(`A ${entity} cannot move from "${from}" to "${to}"`);
  }
}

export function canMoveRequest(from: RequestStatus, to: RequestStatus): boolean {
  return REQUEST_TRANSITIONS[from].includes(to);
}

export function assertRequestTransition(from: RequestStatus, to: RequestStatus): void {
  if (!canMoveRequest(from, to)) throw new InvalidTransitionError('request', from, to);
}

export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  if (!TASK_TRANSITIONS[from].includes(to)) throw new InvalidTransitionError('task', from, to);
}

export const DECISIONS = ['approve', 'reject', 'send_back'] as const;
export type Decision = (typeof DECISIONS)[number];

export const ROLES = ['admin', 'approver', 'employee'] as const;
export type Role = (typeof ROLES)[number];
