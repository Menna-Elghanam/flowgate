import {
  REQUEST_STATUSES,
  ROLES,
  TASK_STATUSES,
  type FormData,
  type WorkflowDefinition,
} from '@flowgate/workflow';
import { sql } from 'drizzle-orm';
import {
  bigserial,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const roleEnum = pgEnum('role', ROLES);
export const requestStatusEnum = pgEnum('request_status', REQUEST_STATUSES);
export const taskStatusEnum = pgEnum('task_status', TASK_STATUSES);
export const versionStatusEnum = pgEnum('version_status', ['draft', 'published']);

// ---------- Accounts ----------

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Always stored lower-cased, so the unique constraint is case-insensitive. */
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the cookie value: a leaked database can't be used to log in. */
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

// ---------- Organizations ----------

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  'memberships',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roles: roleEnum('roles').array().notNull(),
    /** Used by "requester's manager" steps and by escalation. */
    managerId: uuid('manager_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.userId] }),
    index('memberships_user_idx').on(t.userId),
    index('memberships_manager_idx').on(t.orgId, t.managerId),
  ],
);

export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    roles: roleEnum('roles').array().notNull(),
    managerId: uuid('manager_id').references(() => users.id, { onDelete: 'set null' }),
    tokenHash: text('token_hash').notNull().unique(),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('invites_org_idx').on(t.orgId)],
);

// ---------- Workflows ----------

export const workflows = pgTable(
  'workflows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** The version new requests use. Null until the first publish. */
    publishedVersionId: uuid('published_version_id').references(
      (): AnyPgColumn => workflowVersions.id,
    ),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('workflows_org_name_uq').on(t.orgId, t.name)],
);

export const workflowVersions = pgTable(
  'workflow_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    status: versionStatusEnum('status').notNull(),
    definition: jsonb('definition').$type<WorkflowDefinition>().notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: uuid('published_by').references(() => users.id),
  },
  (t) => [
    uniqueIndex('workflow_versions_number_uq').on(t.workflowId, t.version),
    // At most one draft per workflow.
    uniqueIndex('workflow_versions_one_draft_uq')
      .on(t.workflowId)
      .where(sql`${t.status} = 'draft'`),
  ],
);

// ---------- Runtime ----------

export const requests = pgTable(
  'requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id),
    /** The version this request follows for its whole life (ADR 0002, rule 5). */
    workflowVersionId: uuid('workflow_version_id')
      .notNull()
      .references(() => workflowVersions.id),
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    data: jsonb('data').$type<FormData>().notNull(),
    status: requestStatusEnum('status').notNull(),
    /** The approval step the request is waiting at (kept while changes are requested). */
    currentStepId: text('current_step_id'),
    /** Increases every time a step is entered; tasks from older visits never count. */
    activation: integer('activation').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('requests_org_requester_idx').on(t.orgId, t.requesterId),
    index('requests_org_status_idx').on(t.orgId, t.status),
    index('requests_workflow_idx').on(t.workflowId),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    stepId: text('step_id').notNull(),
    /** Copied from the definition so lists and reports don't need to load the JSON. */
    stepName: text('step_name').notNull(),
    activation: integer('activation').notNull(),
    assigneeId: uuid('assignee_id')
      .notNull()
      .references(() => users.id),
    status: taskStatusEnum('status').notNull().default('pending'),
    comment: text('comment'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    escalatedFromId: uuid('escalated_from_id').references((): AnyPgColumn => tasks.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('tasks_inbox_idx').on(t.orgId, t.assigneeId, t.status),
    index('tasks_request_idx').on(t.requestId),
    // The deadline sweep only ever looks at open tasks with a deadline.
    index('tasks_open_due_idx')
      .on(t.dueAt)
      .where(sql`${t.status} = 'pending' AND ${t.dueAt} IS NOT NULL`),
    // Nobody gets two open tasks for the same visit of a step.
    uniqueIndex('tasks_one_open_per_assignee_uq')
      .on(t.requestId, t.activation, t.assigneeId)
      .where(sql`${t.status} = 'pending'`),
  ],
);

/** Append-only: a database trigger rejects UPDATE and DELETE (see migration 0001). */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id').references(() => requests.id, { onDelete: 'cascade' }),
    workflowId: uuid('workflow_id').references(() => workflows.id, { onDelete: 'cascade' }),
    /** Null when the system acted (e.g. a deadline escalation). */
    actorId: uuid('actor_id').references(() => users.id),
    action: text('action').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    stepId: text('step_id'),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_org_created_idx').on(t.orgId, t.createdAt),
    index('audit_request_idx').on(t.requestId),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type MembershipRow = typeof memberships.$inferSelect;
export type WorkflowRow = typeof workflows.$inferSelect;
export type WorkflowVersionRow = typeof workflowVersions.$inferSelect;
export type RequestRow = typeof requests.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type AuditEventRow = typeof auditEvents.$inferSelect;
