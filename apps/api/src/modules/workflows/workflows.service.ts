import {
  starterDefinition,
  validateDefinition,
  type ValidationIssue,
  type WorkflowDefinition,
} from '@flowgate/workflow';
import { Injectable } from '@nestjs/common';
import type { OrgMember } from '../../core/auth/context';
import { Clock } from '../../core/clock';
import { recordAudit } from '../../core/db/audit';
import { UnitOfWork } from '../../core/effects/unit-of-work';
import { AppError, conflict, notFound } from '../../core/errors';
import type { CreateWorkflowInput, UpdateWorkflowInput } from './workflows.schemas';
import { WorkflowsRepository } from './workflows.repository';

/** Graph checks from the shared package plus the one that needs the database. */
export type PublishIssue =
  ValidationIssue | { code: 'UNKNOWN_USER'; message: string; nodeId: string };

@Injectable()
export class WorkflowsService {
  constructor(
    private readonly repo: WorkflowsRepository,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  list(member: OrgMember) {
    return this.repo.list(member.orgId);
  }

  available(member: OrgMember) {
    return this.repo.listPublished(member.orgId);
  }

  async create(member: OrgMember, input: CreateWorkflowInput) {
    const workflow = await this.uow.run(async (tx) => {
      const created = await this.repo.create(
        tx,
        {
          orgId: member.orgId,
          name: input.name,
          description: input.description,
          createdBy: member.userId,
        },
        starterDefinition(),
      );
      await recordAudit(tx, {
        orgId: member.orgId,
        workflowId: created.id,
        actorId: member.userId,
        action: 'workflow_created',
        details: { name: created.name },
        createdAt: this.clock.now(),
      });
      return created;
    });
    return this.get(member, workflow.id);
  }

  async get(member: OrgMember, workflowId: string) {
    const workflow = await this.repo.find(member.orgId, workflowId);
    if (!workflow) throw notFound('Workflow');
    const versions = await this.repo.versions(workflowId);
    const draft = versions.find((v) => v.status === 'draft') ?? null;
    const published = versions.find((v) => v.id === workflow.publishedVersionId) ?? null;
    return {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        status: v.status,
        publishedAt: v.publishedAt,
        isCurrent: v.id === workflow.publishedVersionId,
      })),
      draft: draft && {
        id: draft.id,
        version: draft.version,
        definition: draft.definition,
        updatedAt: draft.updatedAt,
      },
      published: published && {
        id: published.id,
        version: published.version,
        definition: published.definition,
      },
      issues: draft ? await this.check(member.orgId, draft.definition) : [],
    };
  }

  async update(member: OrgMember, workflowId: string, input: UpdateWorkflowInput) {
    const row = await this.repo.update(member.orgId, workflowId, input);
    if (!row) throw notFound('Workflow');
    return this.get(member, workflowId);
  }

  /** Saves the draft (creating version N+1 if only published versions exist). */
  async saveDraft(member: OrgMember, workflowId: string, definition: WorkflowDefinition) {
    const draft = await this.uow.run(async (tx) => {
      const workflow = await this.repo.find(member.orgId, workflowId, tx);
      if (!workflow) throw notFound('Workflow');
      const versions = await this.repo.versions(workflowId, tx);
      const existing = versions.find((v) => v.status === 'draft');
      await this.repo.touch(tx, workflowId);
      if (existing) {
        await this.repo.updateDraft(tx, existing.id, definition);
        return { id: existing.id, version: existing.version };
      }
      const next = (versions[0]?.version ?? 0) + 1;
      const created = await this.repo.insertDraft(tx, workflowId, member.orgId, next, definition);
      return { id: created.id, version: created.version };
    });
    return { draft: { ...draft, definition }, issues: await this.check(member.orgId, definition) };
  }

  async discardDraft(member: OrgMember, workflowId: string) {
    await this.uow.run(async (tx) => {
      const workflow = await this.repo.find(member.orgId, workflowId, tx);
      if (!workflow) throw notFound('Workflow');
      const draft = (await this.repo.versions(workflowId, tx)).find((v) => v.status === 'draft');
      if (!draft) throw notFound('Draft');
      if (!workflow.publishedVersionId) {
        throw conflict('ONLY_VERSION', 'This is the only version; there is nothing to go back to');
      }
      await this.repo.deleteDraft(tx, draft.id);
    });
    return this.get(member, workflowId);
  }

  async publish(member: OrgMember, workflowId: string) {
    const result = await this.uow.run(async (tx) => {
      const workflow = await this.repo.find(member.orgId, workflowId, tx);
      if (!workflow) throw notFound('Workflow');
      const draft = (await this.repo.versions(workflowId, tx)).find((v) => v.status === 'draft');
      if (!draft) throw conflict('NO_DRAFT', 'There are no unpublished changes');

      const issues = await this.check(member.orgId, draft.definition);
      if (issues.length > 0) {
        throw new AppError(
          422,
          'WORKFLOW_INVALID',
          'Fix the problems in the workflow before publishing',
          issues,
        );
      }
      const now = this.clock.now();
      await this.repo.publish(tx, workflowId, draft.id, member.userId, now);
      await recordAudit(tx, {
        orgId: member.orgId,
        workflowId,
        actorId: member.userId,
        action: 'workflow_published',
        details: { name: workflow.name, version: draft.version },
        createdAt: now,
      });
      return { version: draft.version };
    });
    return { ...(await this.get(member, workflowId)), publishedNow: result.version };
  }

  private async check(orgId: string, definition: WorkflowDefinition): Promise<PublishIssue[]> {
    const issues: PublishIssue[] = validateDefinition(definition);
    const wanted = new Set<string>();
    for (const node of definition.nodes) {
      if (node.type === 'approval' && node.assignee.kind === 'users') {
        node.assignee.userIds.forEach((id) => wanted.add(id));
      }
    }
    const members = await this.repo.existingMembers(orgId, [...wanted]);
    for (const node of definition.nodes) {
      if (node.type !== 'approval' || node.assignee.kind !== 'users') continue;
      if (node.assignee.userIds.some((id) => !members.has(id))) {
        issues.push({
          code: 'UNKNOWN_USER',
          message: `"${node.name}" is assigned to someone who is not a member any more`,
          nodeId: node.id,
        });
      }
    }
    return issues;
  }
}
