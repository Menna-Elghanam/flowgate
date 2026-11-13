'use client';

import { REQUEST_STATUSES, type RequestStatus } from '@flowgate/workflow';
import Link from 'next/link';
import { use, useState } from 'react';
import { RequestStatusBadge } from '@/components/status-badge';
import {
  ButtonLink,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Select,
} from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { REQUEST_STATUS_LABEL, relativeTime } from '@/lib/format';
import { useIsAdmin, useRequests } from '@/lib/queries';

export default function RequestsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = use(params);
  const isAdmin = useIsAdmin(orgId);
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [status, setStatus] = useState<RequestStatus | ''>('');
  const showAll = isAdmin && scope === 'all';
  const requests = useRequests(orgId, showAll ? 'all' : 'mine', status);

  return (
    <>
      <PageHeader
        title={showAll ? 'All requests' : 'My requests'}
        description="Track where each request is and who has to act next."
        actions={<ButtonLink href={`/o/${orgId}/requests/new`}>New request</ButtonLink>}
      />
      <div className="mb-4 flex flex-wrap gap-3">
        {isAdmin && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            Show
            <Select
              className="w-auto"
              value={scope}
              onChange={(e) => setScope(e.target.value as 'mine' | 'all')}
            >
              <option value="mine">My requests</option>
              <option value="all">Everyone&apos;s requests</option>
            </Select>
          </label>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-700">
          Status
          <Select
            className="w-auto"
            value={status}
            onChange={(e) => setStatus(e.target.value as RequestStatus | '')}
          >
            <option value="">Any</option>
            {REQUEST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {REQUEST_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {requests.isPending ? (
        <LoadingState />
      ) : requests.isError ? (
        <ErrorState message={errorMessage(requests.error)} onRetry={() => requests.refetch()} />
      ) : requests.data.length === 0 ? (
        <EmptyState title="No requests found">
          {status ? 'Try another status.' : 'Submit your first request with "New request".'}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 uppercase">
              <tr>
                <th className="px-4 py-2 font-medium">Request</th>
                {showAll && <th className="px-4 py-2 font-medium">Requester</th>}
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Current step</th>
                <th className="px-4 py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {requests.data.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/o/${orgId}/requests/${r.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {r.title}
                    </Link>
                    <p className="text-xs text-slate-500">{r.workflowName}</p>
                  </td>
                  {showAll && <td className="px-4 py-3">{r.requesterName}</td>}
                  <td className="px-4 py-3">
                    <RequestStatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-700">{r.currentStepName ?? '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                    {relativeTime(r.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
