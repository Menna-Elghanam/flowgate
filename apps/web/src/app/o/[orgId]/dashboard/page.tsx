'use client';

import { use } from 'react';
import { AdminOnly } from '@/components/admin-only';
import { Card, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useDashboard } from '@/lib/queries';

const hours = (value: number | null) =>
  value === null ? '—' : value < 1 ? `${Math.round(value * 60)} min` : `${value.toFixed(1)} h`;

function Stat({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  return (
    <Card>
      <p className="text-sm text-slate-600">{label}</p>
      <p
        className={`mt-1 text-3xl font-semibold tabular-nums ${alert && value > 0 ? 'text-red-700' : ''}`}
      >
        {value}
      </p>
    </Card>
  );
}

function DashboardView({ orgId }: { orgId: string }) {
  const dashboard = useDashboard(orgId);
  if (dashboard.isPending) return <LoadingState />;
  if (dashboard.isError)
    return (
      <ErrorState message={errorMessage(dashboard.error)} onRetry={() => dashboard.refetch()} />
    );
  const { totals, workflows, slowestSteps } = dashboard.data;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open requests" value={totals.openRequests} />
        <Stat label="Open approvals" value={totals.openTasks} />
        <Stat label="Overdue approvals" value={totals.overdueTasks} alert />
        <Stat label="Finished in last 30 days" value={totals.finishedLast30Days} />
      </div>

      <Card>
        <h2 className="mb-3 font-semibold">Workflows</h2>
        {workflows.length === 0 ? (
          <EmptyState title="No requests yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-600 uppercase">
                <tr>
                  <th className="py-2 pr-4 font-medium">Workflow</th>
                  <th className="py-2 pr-4 text-right font-medium">Total</th>
                  <th className="py-2 pr-4 text-right font-medium">Open</th>
                  <th className="py-2 pr-4 text-right font-medium">Approved</th>
                  <th className="py-2 pr-4 text-right font-medium">Rejected</th>
                  <th className="py-2 pr-4 text-right font-medium">Withdrawn</th>
                  <th className="py-2 text-right font-medium">Avg. time to finish</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 tabular-nums">
                {workflows.map((w) => (
                  <tr key={w.workflowId}>
                    <td className="py-2 pr-4 font-medium">{w.name}</td>
                    <td className="py-2 pr-4 text-right">{w.total}</td>
                    <td className="py-2 pr-4 text-right">{w.open}</td>
                    <td className="py-2 pr-4 text-right">{w.approved}</td>
                    <td className="py-2 pr-4 text-right">{w.rejected}</td>
                    <td className="py-2 pr-4 text-right">{w.cancelled}</td>
                    <td className="py-2 text-right">{hours(w.avgHoursToFinish)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold">Bottlenecks</h2>
        <p className="mb-3 text-sm text-slate-600">
          Steps where decisions take longest on average.
        </p>
        {slowestSteps.length === 0 ? (
          <p className="text-sm text-slate-600">No decisions yet.</p>
        ) : (
          <ol className="space-y-2">
            {slowestSteps.map((s) => (
              <li
                key={`${s.workflowName}-${s.stepName}`}
                className="flex justify-between gap-4 text-sm"
              >
                <span>
                  <span className="font-medium">{s.stepName}</span>{' '}
                  <span className="text-slate-600">in {s.workflowName}</span>
                </span>
                <span className="tabular-nums text-slate-700">
                  {hours(s.avgHoursToDecide)} · {s.decisions} decision{s.decisions === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

export default function DashboardPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = use(params);
  return (
    <>
      <PageHeader title="Dashboard" description="How fast requests move, and where they wait." />
      <AdminOnly orgId={orgId}>
        <DashboardView orgId={orgId} />
      </AdminOnly>
    </>
  );
}
