import {
  assertRequestTransition,
  assertTaskTransition,
  buildFormDataSchema,
  findApprovalNode,
  nextStop,
  startNodeId,
  type ApprovalNode,
  type Decision,
  type FormData,
  type RequestStatus,
  type TaskStatus,
  type WorkflowDefinition,
} from '@flowgate/workflow';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { OrgMember } from '../core/auth/context';
import { addHours, Clock } from '../core/clock';
import { CONFIG, type Config } from '../core/config';
import { recordAudit, type NewAuditEvent } from '../core/db/audit';
import { DB, type Db, type Tx } from '../core/db/db.module';
import {
  requests,
  tasks,
  users,
  workflows,
  workflowVersions,
  type RequestRow,
  type TaskRow,
} from '../core/db/schema';
import type { Effects } from '../core/effects/effects';
import { UnitOfWork } from '../core/effects/unit-of-work';
import { AppError, conflict, notFound } from '../core/errors';
import { validationError } from '../core/zod-pipe';
import { escalationTargets, resolveAssignees } from './assignees';

/** Everything one engine operation needs, threaded through the private steps below. */
interface Ctx {
  tx: Tx;
  fx: Effects;
  now: Date;
  actorId: string | null;
  request: RequestRow;
  definition: WorkflowDefinition;
  requesterName: string;
}

type AuditInput = Omit<NewAuditEvent, 'orgId' | 'requestId' | 'createdAt' | 'actorId'>;

/**
 * The workflow engine (ADR 0002). Every command runs in one transaction that starts by
 * locking the request row, so concurrent actions on one request are applied one at a time.
 */
@Injectable()
export class EngineService {
  private readonly logger = new Logger('Engine');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  // ------------------------------------------------------------------ commands

  submit(actor: OrgMember, input: { workflowId: string; title: string; data: unknown }) {
    return this.uow.run(async (tx, fx) => {
      const [workflow] = await tx
        .select({
          name: workflows.name,
          versionId: workflowVersions.id,
          version: workflowVersions.version,
          definition: workflowVersions.definition,
        })
        .from(workflows)
        .innerJoin(workflowVersions, eq(workflowVersions.id, workflows.publishedVersionId))
        .where(and(eq(workflows.id, input.workflowId), eq(workflows.orgId, actor.orgId)));
      if (!workflow) throw notFound('Workflow');

      const data = this.parseFormData(workflow.definition, input.data);
      const now = this.clock.now();
      const [request] = await tx
        .insert(requests)
        .values({
          orgId: actor.orgId,
          workflowId: input.workflowId,
          workflowVersionId: workflow.versionId,
          requesterId: actor.userId,
          title: input.title,
          data,
          status: 'in_progress',
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!request) throw new Error('Insert returned no row');

      const ctx = await this.context(tx, fx, request, actor.userId, now);
      await this.audit(ctx, {
        action: 'request_submitted',
        toStatus: 'in_progress',
        details: { workflowName: workflow.name, version: workflow.version },
      });
      await this.moveOn(ctx, startNodeId(workflow.definition));
      return { id: request.id, status: ctx.request.status };
    });
  }

  decide(actor: OrgMember, taskId: string, decision: Decision, comment: string | null) {
    return this.uow.run(async (tx, fx) => {
      const [owned] = await tx
        .select({ requestId: tasks.requestId })
        .from(tasks)
        .where(
          and(
            eq(tasks.id, taskId),
            eq(tasks.orgId, actor.orgId),
            eq(tasks.assigneeId, actor.userId),
          ),
        );
      if (!owned) throw notFound('Task');

      const request = await this.lockRequest(tx, actor.orgId, owned.requestId);
      // Read the task only after taking the lock, so we see any decision made just before us.
      const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
      if (!request || !task) throw notFound('Task');
      if (task.status !== 'pending') {
        throw conflict(
          'TASK_ALREADY_DECIDED',
          `This task is already ${task.status.replace('_', ' ')}`,
          {
            status: task.status,
          },
        );
      }
      if (request.status !== 'in_progress' || task.activation !== request.activation) {
        throw conflict('TASK_STALE', 'This request has moved on since the task was created');
      }

      const now = this.clock.now();
      const ctx = await this.context(tx, fx, request, actor.userId, now);
      const status: TaskStatus =
        decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'sent_back';
      assertTaskTransition(task.status, status);
      await tx.update(tasks).set({ status, comment, decidedAt: now }).where(eq(tasks.id, task.id));
      await this.audit(ctx, {
        action: `task_${status}`,
        stepId: task.stepId,
        details: { stepName: task.stepName, taskId: task.id, ...(comment ? { comment } : {}) },
      });

      if (decision === 'reject') {
        await this.finish(ctx, 'rejected', { stepName: task.stepName, comment });
      } else if (decision === 'send_back') {
        await this.sendBack(ctx, task, comment ?? '');
      } else {
        await this.afterApproval(ctx, task);
      }
      return { requestId: request.id, status: ctx.request.status };
    });
  }

  resubmit(actor: OrgMember, requestId: string, input: { title?: string; data: unknown }) {
    return this.uow.run(async (tx, fx) => {
      const request = await this.lockRequest(tx, actor.orgId, requestId);
      if (!request || request.requesterId !== actor.userId) throw notFound('Request');
      assertRequestTransition(request.status, 'in_progress');

      const now = this.clock.now();
      const ctx = await this.context(tx, fx, request, actor.userId, now);
      const data = this.parseFormData(ctx.definition, input.data);
      await this.updateRequest(ctx, {
        data,
        title: input.title ?? request.title,
        status: 'in_progress',
      });
      await this.audit(ctx, {
        action: 'request_resubmitted',
        fromStatus: 'changes_requested',
        toStatus: 'in_progress',
        stepId: request.currentStepId,
      });
      if (!request.currentStepId) throw new Error(`Request ${request.id} has no step to return to`);
      // ADR 0002, rule 1: back to the step that sent it back, not to the start.
      await this.enterApproval(ctx, findApprovalNode(ctx.definition, request.currentStepId));
      return { id: request.id, status: ctx.request.status };
    });
  }

  withdraw(actor: OrgMember, requestId: string) {
    return this.uow.run(async (tx, fx) => {
      const request = await this.lockRequest(tx, actor.orgId, requestId);
      if (!request || request.requesterId !== actor.userId) throw notFound('Request');
      const ctx = await this.context(tx, fx, request, actor.userId, this.clock.now());
      await this.finish(ctx, 'cancelled', {});
      return { id: request.id, status: ctx.request.status };
    });
  }

  /**
   * Called by the worker every minute. The database is the source of truth for deadlines:
   * the sweep just asks "which open tasks are overdue?", so a restart or a lost job can't
   * lose an escalation, and the row lock makes each escalation happen exactly once.
   */
  async runDeadlineSweep(): Promise<{ escalated: number; reminded: number }> {
    const now = this.clock.now();
    let escalated = 0;
    const overdue = await this.db
      .select({ id: tasks.id, orgId: tasks.orgId, requestId: tasks.requestId })
      .from(tasks)
      .where(and(eq(tasks.status, 'pending'), isNotNull(tasks.dueAt), lte(tasks.dueAt, now)))
      .orderBy(asc(tasks.dueAt))
      .limit(100);

    for (const candidate of overdue) {
      try {
        const done = await this.uow.run(async (tx, fx) => {
          const request = await this.lockRequest(tx, candidate.orgId, candidate.requestId);
          const [task] = await tx.select().from(tasks).where(eq(tasks.id, candidate.id));
          if (!request || !task || task.status !== 'pending' || !task.dueAt || task.dueAt > now) {
            return false; // someone acted on it in the meantime
          }
          const ctx = await this.context(tx, fx, request, null, now);
          return this.escalateTask(ctx, task, 'deadline');
        });
        if (done) escalated++;
      } catch (error) {
        this.logger.error(`Escalation of task ${candidate.id} failed: ${String(error)}`);
      }
    }

    const reminded = await this.sendReminders(now);
    return { escalated, reminded };
  }

  /** Used when a member is removed: their open tasks move on to someone else right away. */
  async handOverTasksOfRemovedMember(
    tx: Tx,
    fx: Effects,
    orgId: string,
    userId: string,
    actorId: string,
  ) {
    const open = await tx
      .select({ id: tasks.id, requestId: tasks.requestId })
      .from(tasks)
      .where(
        and(eq(tasks.orgId, orgId), eq(tasks.assigneeId, userId), eq(tasks.status, 'pending')),
      );
    for (const item of open) {
      const request = await this.lockRequest(tx, orgId, item.requestId);
      const [task] = await tx.select().from(tasks).where(eq(tasks.id, item.id));
      if (!request || !task || task.status !== 'pending') continue;
      const ctx = await this.context(tx, fx, request, actorId, this.clock.now());
      await this.escalateTask(ctx, task, 'assignee_removed');
    }
  }

  // ------------------------------------------------------------------ steps

  private async moveOn(ctx: Ctx, fromNodeId: string): Promise<void> {
    const stop = nextStop(ctx.definition, fromNodeId, ctx.request.data);
    if (stop.kind === 'end') {
      await this.finish(ctx, stop.node.outcome, { endStepId: stop.node.id });
    } else {
      await this.enterApproval(ctx, stop.node);
    }
  }

  private async enterApproval(ctx: Ctx, node: ApprovalNode): Promise<void> {
    const { tx, request, now } = ctx;
    const resolved = await resolveAssignees(tx, request.orgId, request.requesterId, node.assignee);
    if (resolved.userIds.length === 0) {
      throw new AppError(
        422,
        'NO_ELIGIBLE_APPROVER',
        `Nobody can approve "${node.name}": requesters can't approve their own requests and no manager or admin is available`,
      );
    }

    const activation = request.activation + 1;
    const dueAt = node.dueInHours ? addHours(now, node.dueInHours) : null;
    await this.updateRequest(ctx, { currentStepId: node.id, activation });
    await tx.insert(tasks).values(
      resolved.userIds.map((assigneeId) => ({
        orgId: request.orgId,
        requestId: request.id,
        stepId: node.id,
        stepName: node.name,
        activation,
        assigneeId,
        dueAt,
        createdAt: now,
      })),
    );
    await this.audit(ctx, {
      action: 'step_started',
      stepId: node.id,
      details: {
        stepName: node.name,
        mode: node.mode,
        assigneeIds: resolved.userIds,
        ...(resolved.substituted ? { substituted: true } : {}),
      },
    });

    for (const userId of resolved.userIds) {
      ctx.fx.email({
        template: 'task_assigned',
        toUserId: userId,
        vars: this.vars(ctx, node.name),
      });
    }
    ctx.fx.notify(request.orgId, request.id, [...resolved.userIds, request.requesterId]);
  }

  private async afterApproval(ctx: Ctx, task: TaskRow): Promise<void> {
    const { tx, request } = ctx;
    const node = findApprovalNode(ctx.definition, task.stepId);
    const openOfThisVisit = and(
      eq(tasks.requestId, request.id),
      eq(tasks.activation, task.activation),
      eq(tasks.status, 'pending'),
    );

    // ADR 0002, rule 3: in an "any" step the first approval wins.
    if (node.mode === 'any') {
      const skipped = await tx
        .update(tasks)
        .set({ status: 'skipped', decidedAt: ctx.now })
        .where(openOfThisVisit)
        .returning({ assigneeId: tasks.assigneeId });
      ctx.fx.notify(
        request.orgId,
        request.id,
        skipped.map((t) => t.assigneeId),
      );
    }

    const [open] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(openOfThisVisit);
    if ((open?.n ?? 0) > 0) {
      ctx.fx.notify(request.orgId, request.id, [request.requesterId]);
      return;
    }
    await this.audit(ctx, {
      action: 'step_completed',
      stepId: node.id,
      details: { stepName: node.name },
    });
    await this.moveOn(ctx, node.id);
  }

  private async sendBack(ctx: Ctx, task: TaskRow, comment: string): Promise<void> {
    const { request } = ctx;
    const from = request.status;
    assertRequestTransition(from, 'changes_requested');
    const skipped = await this.skipOpenTasks(ctx);
    await this.updateRequest(ctx, { status: 'changes_requested' });
    await this.audit(ctx, {
      action: 'request_sent_back',
      fromStatus: from,
      toStatus: 'changes_requested',
      stepId: task.stepId,
      details: { stepName: task.stepName, comment },
    });
    ctx.fx.email({
      template: 'changes_requested',
      toUserId: request.requesterId,
      vars: { ...this.vars(ctx, task.stepName), comment },
    });
    ctx.fx.notify(request.orgId, request.id, [request.requesterId, ...skipped]);
  }

  private async finish(
    ctx: Ctx,
    outcome: Extract<RequestStatus, 'approved' | 'rejected' | 'cancelled'>,
    details: Record<string, unknown>,
  ): Promise<void> {
    const { request } = ctx;
    const from = request.status;
    assertRequestTransition(from, outcome);
    const skipped = await this.skipOpenTasks(ctx);
    await this.updateRequest(ctx, { status: outcome, completedAt: ctx.now, currentStepId: null });
    await this.audit(ctx, {
      action: `request_${outcome}`,
      fromStatus: from,
      toStatus: outcome,
      details,
    });
    if (outcome !== 'cancelled') {
      ctx.fx.email({
        template: 'request_completed',
        toUserId: request.requesterId,
        vars: { ...this.vars(ctx, ''), outcome },
      });
    }
    ctx.fx.notify(request.orgId, request.id, [request.requesterId, ...skipped]);
  }

  /** Returns whether the task was handed over to someone (or already covered). */
  private async escalateTask(
    ctx: Ctx,
    task: TaskRow,
    reason: 'deadline' | 'assignee_removed',
  ): Promise<boolean> {
    const { tx, request, now } = ctx;
    const node = findApprovalNode(ctx.definition, task.stepId);
    const exclude = new Set([request.requesterId, task.assigneeId]);
    const targets = await escalationTargets(tx, request.orgId, task.assigneeId, exclude);

    if (targets.length === 0) {
      if (reason === 'assignee_removed') {
        throw conflict(
          'NO_ESCALATION_TARGET',
          `Nobody else can take over "${task.stepName}" on "${request.title}"; add another admin first`,
        );
      }
      // Nobody above: keep the task with its assignee and stop the clock instead of retrying forever.
      await tx.update(tasks).set({ dueAt: null }).where(eq(tasks.id, task.id));
      await this.audit(ctx, {
        action: 'escalation_skipped',
        stepId: task.stepId,
        details: { stepName: task.stepName, taskId: task.id, reason: 'nobody_to_escalate_to' },
      });
      return false;
    }

    const alreadyOpen = await tx
      .select({ assigneeId: tasks.assigneeId })
      .from(tasks)
      .where(
        and(
          eq(tasks.requestId, request.id),
          eq(tasks.activation, task.activation),
          eq(tasks.status, 'pending'),
          inArray(tasks.assigneeId, targets),
        ),
      );
    const covered = new Set(alreadyOpen.map((row) => row.assigneeId));
    const newAssignees = targets.filter((id) => !covered.has(id));

    assertTaskTransition(task.status, 'escalated');
    await tx
      .update(tasks)
      .set({ status: 'escalated', decidedAt: now })
      .where(eq(tasks.id, task.id));
    if (newAssignees.length > 0) {
      await tx.insert(tasks).values(
        newAssignees.map((assigneeId) => ({
          orgId: request.orgId,
          requestId: request.id,
          stepId: task.stepId,
          stepName: task.stepName,
          activation: task.activation,
          assigneeId,
          dueAt: node.dueInHours ? addHours(now, node.dueInHours) : null,
          escalatedFromId: task.id,
          createdAt: now,
        })),
      );
    }
    await this.audit(ctx, {
      action: 'task_escalated',
      stepId: task.stepId,
      details: {
        stepName: task.stepName,
        taskId: task.id,
        from: task.assigneeId,
        to: targets,
        reason,
      },
    });
    for (const userId of newAssignees) {
      ctx.fx.email({
        template: 'task_escalated',
        toUserId: userId,
        vars: this.vars(ctx, task.stepName),
      });
    }
    ctx.fx.notify(request.orgId, request.id, [...targets, task.assigneeId, request.requesterId]);
    return true;
  }

  private async sendReminders(now: Date): Promise<number> {
    // Remind once, when three quarters of the time to the deadline have passed.
    const due = await this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.status, 'pending'),
          isNull(tasks.reminderSentAt),
          isNotNull(tasks.dueAt),
          sql`${tasks.dueAt} > ${now.toISOString()}::timestamptz`,
          sql`${tasks.dueAt} - (${tasks.dueAt} - ${tasks.createdAt}) / 4 <= ${now.toISOString()}::timestamptz`,
        ),
      )
      .limit(500);

    let sent = 0;
    for (const { id } of due) {
      const claimed = await this.uow.run(async (tx, fx) => {
        // The conditional update is the "lock": only one sweep can claim the reminder.
        const [task] = await tx
          .update(tasks)
          .set({ reminderSentAt: now })
          .where(and(eq(tasks.id, id), isNull(tasks.reminderSentAt), eq(tasks.status, 'pending')))
          .returning();
        if (!task) return false;
        const [request] = await tx.select().from(requests).where(eq(requests.id, task.requestId));
        if (!request) return false;
        const ctx = await this.context(tx, fx, request, null, now);
        fx.email({
          template: 'task_reminder',
          toUserId: task.assigneeId,
          vars: { ...this.vars(ctx, task.stepName), dueAt: task.dueAt?.toISOString() ?? '' },
        });
        return true;
      });
      if (claimed) sent++;
    }
    return sent;
  }

  // ------------------------------------------------------------------ helpers

  private async lockRequest(
    tx: Tx,
    orgId: string,
    requestId: string,
  ): Promise<RequestRow | undefined> {
    const [row] = await tx
      .select()
      .from(requests)
      .where(and(eq(requests.id, requestId), eq(requests.orgId, orgId)))
      .for('update');
    return row;
  }

  private async context(
    tx: Tx,
    fx: Effects,
    request: RequestRow,
    actorId: string | null,
    now: Date,
  ): Promise<Ctx> {
    const [[version], [requester]] = await Promise.all([
      tx
        .select({ definition: workflowVersions.definition })
        .from(workflowVersions)
        .where(eq(workflowVersions.id, request.workflowVersionId)),
      tx.select({ name: users.name }).from(users).where(eq(users.id, request.requesterId)),
    ]);
    if (!version) throw new Error(`Workflow version ${request.workflowVersionId} is missing`);
    return {
      tx,
      fx,
      now,
      actorId,
      request: { ...request },
      definition: version.definition,
      requesterName: requester?.name ?? 'Unknown',
    };
  }

  private async updateRequest(ctx: Ctx, patch: Partial<RequestRow>): Promise<void> {
    const values = { ...patch, updatedAt: ctx.now };
    await ctx.tx.update(requests).set(values).where(eq(requests.id, ctx.request.id));
    Object.assign(ctx.request, values);
  }

  private async skipOpenTasks(ctx: Ctx): Promise<string[]> {
    const skipped = await ctx.tx
      .update(tasks)
      .set({ status: 'skipped', decidedAt: ctx.now })
      .where(and(eq(tasks.requestId, ctx.request.id), eq(tasks.status, 'pending')))
      .returning({ assigneeId: tasks.assigneeId });
    return skipped.map((row) => row.assigneeId);
  }

  private async audit(ctx: Ctx, event: AuditInput): Promise<void> {
    await recordAudit(ctx.tx, {
      ...event,
      orgId: ctx.request.orgId,
      requestId: ctx.request.id,
      actorId: ctx.actorId,
      createdAt: ctx.now,
    });
  }

  private parseFormData(definition: WorkflowDefinition, input: unknown): FormData {
    const result = buildFormDataSchema(definition.form).safeParse(input ?? {});
    if (!result.success)
      throw validationError(result.error, 'Some answers in the form are invalid');
    return result.data;
  }

  private vars(ctx: Ctx, stepName: string): Record<string, string> {
    const { request } = ctx;
    return {
      requestTitle: request.title,
      requesterName: ctx.requesterName,
      stepName,
      requestUrl: `${this.config.WEB_ORIGIN}/o/${request.orgId}/requests/${request.id}`,
    };
  }
}
