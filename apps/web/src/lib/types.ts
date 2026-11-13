import type {
  FormData,
  FormDefinition,
  RequestStatus,
  Role,
  TaskStatus,
  ValidationIssue,
  WorkflowDefinition,
} from '@flowgate/workflow';

/** Response shapes of the API, as the web app uses them. Dates arrive as ISO strings. */

export interface Me {
  user: { id: string; email: string; name: string };
  organizations: { id: string; name: string; roles: Role[] }[];
}

export interface OrgInfo {
  id: string;
  name: string;
  myRoles: Role[];
}

export interface InboxTask {
  id: string;
  status: TaskStatus;
  stepName: string;
  dueAt: string | null;
  createdAt: string;
  decidedAt: string | null;
  comment: string | null;
  requestId: string;
  requestTitle: string;
  requestStatus: RequestStatus;
  requesterName: string;
  workflowName: string;
}

export interface RequestSummary {
  id: string;
  title: string;
  status: RequestStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  workflowName: string;
  requesterName: string;
  currentStepName: string | null;
}

export interface RequestTask {
  id: string;
  stepId: string;
  stepName: string;
  activation: number;
  status: TaskStatus;
  comment: string | null;
  dueAt: string | null;
  decidedAt: string | null;
  createdAt: string;
  escalatedFromId: string | null;
  assignee: { id: string; name: string };
}

export interface HistoryEvent {
  id: number;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  stepId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
  actor: { id: string; name: string } | null;
}

export interface RequestDetail {
  id: string;
  title: string;
  status: RequestStatus;
  data: FormData;
  currentStepId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  workflow: { id: string; name: string; version: number };
  requester: { id: string; name: string };
  definition: WorkflowDefinition;
  tasks: RequestTask[];
  history: HistoryEvent[];
  myOpenTask: { id: string; stepName: string; dueAt: string | null } | null;
  permissions: { canResubmit: boolean; canWithdraw: boolean };
}

export interface AvailableWorkflow {
  id: string;
  name: string;
  description: string;
  version: number;
  form: FormDefinition;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  publishedVersion: number | null;
  hasDraft: boolean;
  openRequests: number;
}

export type PublishIssue =
  ValidationIssue | { code: 'UNKNOWN_USER'; message: string; nodeId: string };

export interface WorkflowDetail {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  versions: {
    id: string;
    version: number;
    status: 'draft' | 'published';
    publishedAt: string | null;
    isCurrent: boolean;
  }[];
  draft: { id: string; version: number; definition: WorkflowDefinition; updatedAt: string } | null;
  published: { id: string; version: number; definition: WorkflowDefinition } | null;
  issues: PublishIssue[];
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  roles: Role[];
  managerId: string | null;
  managerName: string | null;
  joinedAt: string;
}

export interface Invite {
  id: string;
  email: string;
  roles: Role[];
  managerId: string | null;
  expiresAt: string;
  link?: string;
}

export interface AuditEvent {
  id: number;
  createdAt: string;
  action: string;
  actorName: string | null;
  actorId: string | null;
  requestId: string | null;
  requestTitle: string | null;
  workflowName: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  stepId: string | null;
  details: Record<string, unknown>;
}

export interface Dashboard {
  totals: {
    openRequests: number;
    openTasks: number;
    overdueTasks: number;
    finishedLast30Days: number;
  };
  workflows: {
    workflowId: string;
    name: string;
    total: number;
    open: number;
    approved: number;
    rejected: number;
    cancelled: number;
    avgHoursToFinish: number | null;
  }[];
  slowestSteps: {
    workflowName: string;
    stepName: string;
    decisions: number;
    avgHoursToDecide: number;
  }[];
}
