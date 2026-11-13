'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { TaskStatusBadge } from '@/components/status-badge';
import { Badge, cx, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { formatDateTime, isOverdue, relativeTime } from '@/lib/format';
import { useInbox } from '@/lib/queries';

export default function InboxPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = use(params);
  const [tab, setTab] = useState<'open' | 'done'>('open');
  const tasks = useInbox(orgId, tab);

  return (
    <>
      <PageHeader title="Inbox" description="Requests waiting for your decision." />
      <div
        role="tablist"
        aria-label="Task filter"
        className="mb-4 flex gap-1 border-b border-slate-200"
      >
        {(['open', 'done'] as const).map((value) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cx(
              '-mb-px border-b-2 px-3 py-2 text-sm',
              tab === value
                ? 'border-brand-600 font-medium text-brand-700'
                : 'border-transparent text-slate-600',
            )}
          >
            {value === 'open' ? 'Waiting for me' : 'Decided'}
          </button>
        ))}
      </div>

      {tasks.isPending ? (
        <LoadingState />
      ) : tasks.isError ? (
        <ErrorState message={errorMessage(tasks.error)} onRetry={() => tasks.refetch()} />
      ) : tasks.data.length === 0 ? (
        <EmptyState title={tab === 'open' ? 'Nothing waiting for you' : 'No decisions yet'}>
          {tab === 'open'
            ? 'New approvals will show up here, live.'
            : 'Requests you decide on will be listed here.'}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {tasks.data.map((task) => {
            const overdue = task.status === 'pending' && isOverdue(task.dueAt);
            return (
              <li key={task.id}>
                <Link
                  href={`/o/${orgId}/requests/${task.requestId}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{task.requestTitle}</p>
                    <p className="text-sm text-slate-600">
                      {task.workflowName} · {task.stepName} · from {task.requesterName}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    {task.status === 'pending' ? (
                      task.dueAt ? (
                        <Badge tone={overdue ? 'danger' : 'neutral'}>
                          <span title={formatDateTime(task.dueAt)}>
                            {overdue ? 'Overdue' : 'Due'} {relativeTime(task.dueAt)}
                          </span>
                        </Badge>
                      ) : (
                        <span>Received {relativeTime(task.createdAt)}</span>
                      )
                    ) : (
                      <>
                        {task.decidedAt && <span>{relativeTime(task.decidedAt)}</span>}
                        <TaskStatusBadge status={task.status} />
                      </>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
