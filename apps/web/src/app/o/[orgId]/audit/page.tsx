'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { use } from 'react';
import { AdminOnly } from '@/components/admin-only';
import { Button, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { actionLabel, formatDateTime } from '@/lib/format';
import { orgKey, useIsAdmin } from '@/lib/queries';
import type { AuditEvent } from '@/lib/types';

interface AuditPage {
  events: AuditEvent[];
  nextCursor: number | null;
}

/** Keyset pagination: each page asks for events older than the last id seen. */
function AuditLog({ orgId }: { orgId: string }) {
  const audit = useInfiniteQuery({
    queryKey: orgKey(orgId, 'audit'),
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) =>
      api<AuditPage>(`/orgs/${orgId}/audit?limit=50${pageParam ? `&before=${pageParam}` : ''}`),
    getNextPageParam: (last) => last.nextCursor,
  });

  if (audit.isPending) return <LoadingState />;
  if (audit.isError)
    return <ErrorState message={errorMessage(audit.error)} onRetry={() => audit.refetch()} />;
  const events = audit.data.pages.flatMap((p) => p.events);
  if (events.length === 0) return <EmptyState title="Nothing recorded yet" />;

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 uppercase">
            <tr>
              <th className="px-4 py-2 font-medium">Time</th>
              <th className="px-4 py-2 font-medium">Who</th>
              <th className="px-4 py-2 font-medium">What</th>
              <th className="px-4 py-2 font-medium">Request / workflow</th>
              <th className="px-4 py-2 font-medium">Status change</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {events.map((e) => (
              <tr key={e.id} className="align-top">
                <td className="px-4 py-2 whitespace-nowrap text-slate-600">
                  {formatDateTime(e.createdAt)}
                </td>
                <td className="px-4 py-2">{e.actorName ?? 'Flowgate'}</td>
                <td className="px-4 py-2">
                  {actionLabel(e.action)}
                  {typeof e.details.stepName === 'string' && (
                    <span className="text-slate-600"> · {e.details.stepName}</span>
                  )}
                  {typeof e.details.comment === 'string' && (
                    <p className="text-xs text-slate-600 italic">“{e.details.comment}”</p>
                  )}
                </td>
                <td className="px-4 py-2">
                  {e.requestId ? (
                    <Link
                      href={`/o/${orgId}/requests/${e.requestId}`}
                      className="text-brand-700 hover:underline"
                    >
                      {e.requestTitle}
                    </Link>
                  ) : (
                    (e.workflowName ?? '—')
                  )}
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-slate-600">
                  {e.fromStatus || e.toStatus
                    ? `${e.fromStatus ?? '—'} → ${e.toStatus ?? '—'}`
                    : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {audit.hasNextPage && (
        <div className="mt-4 text-center">
          <Button
            variant="secondary"
            busy={audit.isFetchingNextPage}
            onClick={() => void audit.fetchNextPage()}
          >
            Load older events
          </Button>
        </div>
      )}
    </>
  );
}

export default function AuditPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = use(params);
  const isAdmin = useIsAdmin(orgId);
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every action, in order. Entries can never be changed or deleted."
        actions={
          isAdmin && (
            <a
              href={`/api/orgs/${orgId}/audit/export.csv`}
              className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
            >
              Export CSV
            </a>
          )
        }
      />
      <AdminOnly orgId={orgId}>
        <AuditLog orgId={orgId} />
      </AdminOnly>
    </>
  );
}
