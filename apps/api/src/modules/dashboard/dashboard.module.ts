import { Controller, Get, Inject, Injectable, Module, UseGuards } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { CurrentMember, Roles, type OrgMember } from '../../core/auth/context';
import { OrgAccessGuard } from '../../core/auth/org-access.guard';
import { Clock } from '../../core/clock';
import { DB, type Db } from '../../core/db/db.module';

interface WorkflowStats {
  workflowId: string;
  name: string;
  total: number;
  open: number;
  approved: number;
  rejected: number;
  cancelled: number;
  avgHoursToFinish: number | null;
}

interface StepStats {
  workflowName: string;
  stepName: string;
  decisions: number;
  avgHoursToDecide: number;
}

/** Reporting queries use plain SQL: aggregates read more clearly than the query builder. */
@Injectable()
export class DashboardService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  async summary(orgId: string) {
    const now = this.clock.now().toISOString();
    const [perWorkflow, slowestSteps, totals] = await Promise.all([
      this.db.execute<Record<string, unknown>>(sql`
        select w.id as "workflowId", w.name,
          count(r.id)::int as total,
          count(r.id) filter (where r.status in ('in_progress', 'changes_requested'))::int as open,
          count(r.id) filter (where r.status = 'approved')::int as approved,
          count(r.id) filter (where r.status = 'rejected')::int as rejected,
          count(r.id) filter (where r.status = 'cancelled')::int as cancelled,
          round((avg(extract(epoch from r.completed_at - r.created_at))
            filter (where r.status in ('approved', 'rejected')) / 3600)::numeric, 1)::float as "avgHoursToFinish"
        from workflows w
        left join requests r on r.workflow_id = w.id
        where w.org_id = ${orgId}
        group by w.id, w.name
        order by total desc, w.name`),
      this.db.execute<Record<string, unknown>>(sql`
        select w.name as "workflowName", t.step_name as "stepName",
          count(*)::int as decisions,
          round((avg(extract(epoch from t.decided_at - t.created_at)) / 3600)::numeric, 1)::float as "avgHoursToDecide"
        from tasks t
        join requests r on r.id = t.request_id
        join workflows w on w.id = r.workflow_id
        where t.org_id = ${orgId} and t.status in ('approved', 'rejected', 'sent_back')
        group by w.name, t.step_name
        order by "avgHoursToDecide" desc
        limit 5`),
      this.db.execute<Record<string, unknown>>(sql`
        select
          (select count(*)::int from requests where org_id = ${orgId}
             and status in ('in_progress', 'changes_requested')) as "openRequests",
          (select count(*)::int from tasks where org_id = ${orgId} and status = 'pending') as "openTasks",
          (select count(*)::int from tasks where org_id = ${orgId} and status = 'pending'
             and due_at < ${now}::timestamptz) as "overdueTasks",
          (select count(*)::int from requests where org_id = ${orgId}
             and completed_at > ${now}::timestamptz - interval '30 days'
             and status in ('approved', 'rejected')) as "finishedLast30Days"`),
    ]);
    return {
      totals: totals.rows[0] as {
        openRequests: number;
        openTasks: number;
        overdueTasks: number;
        finishedLast30Days: number;
      },
      workflows: perWorkflow.rows as unknown as WorkflowStats[],
      slowestSteps: slowestSteps.rows as unknown as StepStats[],
    };
  }
}

@Controller('orgs/:orgId/dashboard')
@UseGuards(OrgAccessGuard)
@Roles('admin')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  get(@CurrentMember() member: OrgMember) {
    return this.dashboard.summary(member.orgId);
  }
}

@Module({ controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
