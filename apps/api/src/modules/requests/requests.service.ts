import { Injectable } from '@nestjs/common';
import type { OrgMember } from '../../core/auth/context';
import { forbidden, notFound } from '../../core/errors';
import { EngineService } from '../../engine/engine.service';
import type {
  DecisionInput,
  ListRequestsQuery,
  ListTasksQuery,
  ResubmitInput,
  SubmitRequestInput,
} from './requests.schemas';
import { RequestsRepository } from './requests.repository';

@Injectable()
export class RequestsService {
  constructor(
    private readonly repo: RequestsRepository,
    private readonly engine: EngineService,
  ) {}

  list(member: OrgMember, query: ListRequestsQuery) {
    if (query.scope === 'all' && !member.roles.includes('admin')) {
      throw forbidden('Only admins can see all requests');
    }
    return this.repo.list(member.orgId, {
      requesterId: query.scope === 'mine' ? member.userId : undefined,
      status: query.status,
    });
  }

  async get(member: OrgMember, requestId: string) {
    const row = await this.repo.findVisible(member.orgId, requestId, {
      userId: member.userId,
      isAdmin: member.roles.includes('admin'),
    });
    if (!row) throw notFound('Request');
    const { request } = row;
    const [taskRows, history] = await Promise.all([
      this.repo.tasksOf(requestId),
      this.repo.historyOf(requestId),
    ]);
    const myOpenTask = taskRows.find(
      (t) => t.status === 'pending' && t.assigneeId === member.userId,
    );
    const isRequester = request.requesterId === member.userId;

    return {
      id: request.id,
      title: request.title,
      status: request.status,
      data: request.data,
      currentStepId: request.currentStepId,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      completedAt: request.completedAt,
      workflow: { id: request.workflowId, name: row.workflowName, version: row.version },
      requester: { id: request.requesterId, name: row.requesterName },
      definition: row.definition,
      tasks: taskRows.map(({ assigneeId, assigneeName, ...task }) => ({
        ...task,
        assignee: { id: assigneeId, name: assigneeName },
      })),
      history: history.map(({ actorId, actorName, ...event }) => ({
        ...event,
        actor: actorId ? { id: actorId, name: actorName ?? 'Former member' } : null,
      })),
      myOpenTask: myOpenTask
        ? { id: myOpenTask.id, stepName: myOpenTask.stepName, dueAt: myOpenTask.dueAt }
        : null,
      permissions: {
        canResubmit: isRequester && request.status === 'changes_requested',
        canWithdraw:
          isRequester &&
          (request.status === 'in_progress' || request.status === 'changes_requested'),
      },
    };
  }

  submit(member: OrgMember, input: SubmitRequestInput) {
    return this.engine.submit(member, input);
  }

  resubmit(member: OrgMember, requestId: string, input: ResubmitInput) {
    return this.engine.resubmit(member, requestId, input);
  }

  withdraw(member: OrgMember, requestId: string) {
    return this.engine.withdraw(member, requestId);
  }

  inbox(member: OrgMember, query: ListTasksQuery) {
    return this.repo.inbox(member.orgId, member.userId, query.status === 'open');
  }

  decide(member: OrgMember, taskId: string, input: DecisionInput) {
    return this.engine.decide(member, taskId, input.decision, input.comment);
  }
}
