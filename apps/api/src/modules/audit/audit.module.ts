import {
  Controller,
  Get,
  Header,
  Inject,
  Injectable,
  Module,
  Query,
  UseGuards,
} from '@nestjs/common';
import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { CurrentMember, Roles, type OrgMember } from '../../core/auth/context';
import { OrgAccessGuard } from '../../core/auth/org-access.guard';
import { DB, type Db } from '../../core/db/db.module';
import { auditEvents, requests, users, workflows } from '../../core/db/schema';
import { ZodPipe } from '../../core/zod-pipe';
import { toCsv } from './csv';

const actors = alias(users, 'actors');

const listAuditSchema = z.object({
  requestId: z.string().uuid().optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
type ListAuditQuery = z.infer<typeof listAuditSchema>;

const EXPORT_LIMIT = 50_000;

@Injectable()
export class AuditRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  list(orgId: string, filter: { requestId?: string; before?: number }, limit: number) {
    const conditions: SQL[] = [eq(auditEvents.orgId, orgId)];
    if (filter.requestId) conditions.push(eq(auditEvents.requestId, filter.requestId));
    if (filter.before) conditions.push(lt(auditEvents.id, filter.before));
    return this.db
      .select({
        id: auditEvents.id,
        createdAt: auditEvents.createdAt,
        action: auditEvents.action,
        actorName: actors.name,
        actorId: auditEvents.actorId,
        requestId: auditEvents.requestId,
        requestTitle: requests.title,
        workflowName: workflows.name,
        fromStatus: auditEvents.fromStatus,
        toStatus: auditEvents.toStatus,
        stepId: auditEvents.stepId,
        details: auditEvents.details,
      })
      .from(auditEvents)
      .leftJoin(actors, eq(actors.id, auditEvents.actorId))
      .leftJoin(requests, eq(requests.id, auditEvents.requestId))
      .leftJoin(workflows, eq(workflows.id, auditEvents.workflowId))
      .where(and(...conditions))
      .orderBy(desc(auditEvents.id))
      .limit(limit);
  }
}

@Controller('orgs/:orgId/audit')
@UseGuards(OrgAccessGuard)
@Roles('admin')
export class AuditController {
  constructor(private readonly repo: AuditRepository) {}

  @Get()
  async list(
    @CurrentMember() member: OrgMember,
    @Query(new ZodPipe(listAuditSchema)) query: ListAuditQuery,
  ) {
    const events = await this.repo.list(member.orgId, query, query.limit + 1);
    const hasMore = events.length > query.limit;
    const page = events.slice(0, query.limit);
    return { events: page, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null };
  }

  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="flowgate-audit.csv"')
  async export(@CurrentMember() member: OrgMember) {
    const events = await this.repo.list(member.orgId, {}, EXPORT_LIMIT);
    return toCsv(
      ['id', 'time', 'action', 'actor', 'request', 'workflow', 'from', 'to', 'step', 'details'],
      events.map((e) => [
        e.id,
        e.createdAt,
        e.action,
        e.actorName ?? (e.actorId ? 'Former member' : 'System'),
        e.requestTitle,
        e.workflowName,
        e.fromStatus,
        e.toStatus,
        e.stepId,
        e.details,
      ]),
    );
  }
}

@Module({ controllers: [AuditController], providers: [AuditRepository] })
export class AuditModule {}
