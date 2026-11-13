import type { RequestStatus } from '@flowgate/workflow';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DB, type Db } from '../../core/db/db.module';
import {
  auditEvents,
  requests,
  tasks,
  users,
  workflows,
  workflowVersions,
} from '../../core/db/schema';

const requesters = alias(users, 'requesters');
const assignees = alias(users, 'assignees');
const actors = alias(users, 'actors');

@Injectable()
export class RequestsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  list(orgId: string, filter: { requesterId?: string; status?: RequestStatus }) {
    const conditions: SQL[] = [eq(requests.orgId, orgId)];
    if (filter.requesterId) conditions.push(eq(requests.requesterId, filter.requesterId));
    if (filter.status) conditions.push(eq(requests.status, filter.status));
    return this.db
      .select({
        id: requests.id,
        title: requests.title,
        status: requests.status,
        createdAt: requests.createdAt,
        updatedAt: requests.updatedAt,
        completedAt: requests.completedAt,
        workflowName: workflows.name,
        requesterName: requesters.name,
        currentStepName: sql<string | null>`(
          select ${tasks.stepName} from ${tasks}
          where ${tasks.requestId} = ${requests.id} and ${tasks.activation} = ${requests.activation}
          limit 1)`,
      })
      .from(requests)
      .innerJoin(workflows, eq(workflows.id, requests.workflowId))
      .innerJoin(requesters, eq(requesters.id, requests.requesterId))
      .where(and(...conditions))
      .orderBy(desc(requests.createdAt))
      .limit(200);
  }

  /**
   * Visibility is part of the query (CLAUDE.md: permissions in the database query): the
   * requester, anyone who was ever asked to decide on it, and admins can see a request.
   */
  async findVisible(
    orgId: string,
    requestId: string,
    viewer: { userId: string; isAdmin: boolean },
  ) {
    const canSee = viewer.isAdmin
      ? sql`true`
      : or(
          eq(requests.requesterId, viewer.userId),
          sql`exists (select 1 from ${tasks} where ${tasks.requestId} = ${requests.id}
                      and ${tasks.assigneeId} = ${viewer.userId})`,
        );
    const [row] = await this.db
      .select({
        request: requests,
        workflowName: workflows.name,
        version: workflowVersions.version,
        definition: workflowVersions.definition,
        requesterName: requesters.name,
      })
      .from(requests)
      .innerJoin(workflows, eq(workflows.id, requests.workflowId))
      .innerJoin(workflowVersions, eq(workflowVersions.id, requests.workflowVersionId))
      .innerJoin(requesters, eq(requesters.id, requests.requesterId))
      .where(and(eq(requests.id, requestId), eq(requests.orgId, orgId), canSee));
    return row;
  }

  tasksOf(requestId: string) {
    return this.db
      .select({
        id: tasks.id,
        stepId: tasks.stepId,
        stepName: tasks.stepName,
        activation: tasks.activation,
        status: tasks.status,
        comment: tasks.comment,
        dueAt: tasks.dueAt,
        decidedAt: tasks.decidedAt,
        createdAt: tasks.createdAt,
        escalatedFromId: tasks.escalatedFromId,
        assigneeId: tasks.assigneeId,
        assigneeName: assignees.name,
      })
      .from(tasks)
      .innerJoin(assignees, eq(assignees.id, tasks.assigneeId))
      .where(eq(tasks.requestId, requestId))
      .orderBy(asc(tasks.createdAt), asc(assignees.name));
  }

  historyOf(requestId: string) {
    return this.db
      .select({
        id: auditEvents.id,
        action: auditEvents.action,
        fromStatus: auditEvents.fromStatus,
        toStatus: auditEvents.toStatus,
        stepId: auditEvents.stepId,
        details: auditEvents.details,
        createdAt: auditEvents.createdAt,
        actorId: auditEvents.actorId,
        actorName: actors.name,
      })
      .from(auditEvents)
      .leftJoin(actors, eq(actors.id, auditEvents.actorId))
      .where(eq(auditEvents.requestId, requestId))
      .orderBy(asc(auditEvents.id));
  }

  inbox(orgId: string, userId: string, open: boolean) {
    return this.db
      .select({
        id: tasks.id,
        status: tasks.status,
        stepName: tasks.stepName,
        dueAt: tasks.dueAt,
        createdAt: tasks.createdAt,
        decidedAt: tasks.decidedAt,
        comment: tasks.comment,
        requestId: requests.id,
        requestTitle: requests.title,
        requestStatus: requests.status,
        requesterName: requesters.name,
        workflowName: workflows.name,
      })
      .from(tasks)
      .innerJoin(requests, eq(requests.id, tasks.requestId))
      .innerJoin(requesters, eq(requesters.id, requests.requesterId))
      .innerJoin(workflows, eq(workflows.id, requests.workflowId))
      .where(
        and(
          eq(tasks.orgId, orgId),
          eq(tasks.assigneeId, userId),
          open ? eq(tasks.status, 'pending') : ne(tasks.status, 'pending'),
        ),
      )
      .orderBy(
        ...(open
          ? [sql`${tasks.dueAt} asc nulls last`, asc(tasks.createdAt)]
          : [desc(sql`coalesce(${tasks.decidedAt}, ${tasks.createdAt})`)]),
      )
      .limit(open ? 500 : 100);
  }
}
