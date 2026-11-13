import type { WorkflowDefinition } from '@flowgate/workflow';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { DB, type Db, type Executor } from '../../core/db/db.module';
import { memberships, workflows, workflowVersions } from '../../core/db/schema';

@Injectable()
export class WorkflowsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  list(orgId: string) {
    // Drizzle leaves columns unqualified in single-table queries, so the subqueries name
    // their tables explicitly; otherwise "id" inside them would mean the subquery's own id.
    return this.db
      .select({
        id: workflows.id,
        name: workflows.name,
        description: workflows.description,
        updatedAt: workflows.updatedAt,
        publishedVersion: sql<number | null>`(
          select v.version from workflow_versions v where v.id = workflows.published_version_id)`,
        hasDraft: sql<boolean>`exists (
          select 1 from workflow_versions v where v.workflow_id = workflows.id and v.status = 'draft')`,
        openRequests: sql<number>`(
          select count(*)::int from requests r
          where r.workflow_id = workflows.id and r.status in ('in_progress', 'changes_requested'))`,
      })
      .from(workflows)
      .where(eq(workflows.orgId, orgId))
      .orderBy(asc(workflows.name));
  }

  listPublished(orgId: string) {
    return this.db
      .select({
        id: workflows.id,
        name: workflows.name,
        description: workflows.description,
        version: workflowVersions.version,
        form: sql<WorkflowDefinition['form']>`${workflowVersions.definition} -> 'form'`,
      })
      .from(workflows)
      .innerJoin(workflowVersions, eq(workflowVersions.id, workflows.publishedVersionId))
      .where(and(eq(workflows.orgId, orgId), isNotNull(workflows.publishedVersionId)))
      .orderBy(asc(workflows.name));
  }

  async find(orgId: string, workflowId: string, tx?: Executor) {
    const query = (tx ?? this.db)
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, workflowId), eq(workflows.orgId, orgId)));
    // Inside a transaction, lock the workflow so two publishes can't interleave.
    const [row] = tx ? await query.for('update') : await query;
    return row;
  }

  versions(workflowId: string, db: Executor = this.db) {
    return db
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.workflowId, workflowId))
      .orderBy(desc(workflowVersions.version));
  }

  async create(
    tx: Executor,
    values: typeof workflows.$inferInsert,
    definition: WorkflowDefinition,
  ) {
    const [workflow] = await tx.insert(workflows).values(values).returning();
    if (!workflow) throw new Error('Insert returned no row');
    await tx.insert(workflowVersions).values({
      workflowId: workflow.id,
      orgId: workflow.orgId,
      version: 1,
      status: 'draft',
      definition,
    });
    return workflow;
  }

  async update(orgId: string, workflowId: string, patch: Partial<typeof workflows.$inferInsert>) {
    const [row] = await this.db
      .update(workflows)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(workflows.id, workflowId), eq(workflows.orgId, orgId)))
      .returning();
    return row;
  }

  async updateDraft(tx: Executor, versionId: string, definition: WorkflowDefinition) {
    await tx
      .update(workflowVersions)
      .set({ definition, updatedAt: new Date() })
      .where(and(eq(workflowVersions.id, versionId), eq(workflowVersions.status, 'draft')));
  }

  async insertDraft(
    tx: Executor,
    workflowId: string,
    orgId: string,
    version: number,
    definition: WorkflowDefinition,
  ) {
    const [row] = await tx
      .insert(workflowVersions)
      .values({ workflowId, orgId, version, status: 'draft', definition })
      .returning();
    if (!row) throw new Error('Insert returned no row');
    return row;
  }

  async deleteDraft(tx: Executor, versionId: string) {
    await tx
      .delete(workflowVersions)
      .where(and(eq(workflowVersions.id, versionId), eq(workflowVersions.status, 'draft')));
  }

  async publish(tx: Executor, workflowId: string, versionId: string, userId: string, now: Date) {
    await tx
      .update(workflowVersions)
      .set({ status: 'published', publishedAt: now, publishedBy: userId, updatedAt: now })
      .where(eq(workflowVersions.id, versionId));
    await tx
      .update(workflows)
      .set({ publishedVersionId: versionId, updatedAt: now })
      .where(eq(workflows.id, workflowId));
  }

  async touch(tx: Executor, workflowId: string) {
    await tx.update(workflows).set({ updatedAt: new Date() }).where(eq(workflows.id, workflowId));
  }

  async existingMembers(orgId: string, userIds: string[]) {
    if (userIds.length === 0) return new Set<string>();
    const rows = await this.db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), inArray(memberships.userId, userIds)));
    return new Set(rows.map((row) => row.userId));
  }
}
