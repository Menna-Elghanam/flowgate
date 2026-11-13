'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';
import { RequestForm } from '@/components/request-form';
import { Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { orgKey, useAvailableWorkflows, useIsAdmin } from '@/lib/queries';

export default function NewRequestPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const isAdmin = useIsAdmin(orgId);
  const workflows = useAvailableWorkflows(orgId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = workflows.data?.find((w) => w.id === selectedId) ?? null;

  if (workflows.isPending) return <LoadingState />;
  if (workflows.isError)
    return (
      <ErrorState message={errorMessage(workflows.error)} onRetry={() => workflows.refetch()} />
    );

  if (!selected) {
    return (
      <>
        <PageHeader title="New request" description="What do you need approved?" />
        {workflows.data.length === 0 ? (
          <EmptyState title="No request types yet">
            {isAdmin
              ? 'Create and publish a workflow first.'
              : 'Ask an admin to publish a workflow.'}
          </EmptyState>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {workflows.data.map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(w.id)}
                  className="h-full w-full rounded-lg border border-slate-200 bg-white p-4 text-left shadow-xs hover:border-brand-500"
                >
                  <p className="font-medium">{w.name}</p>
                  {w.description && <p className="mt-1 text-sm text-slate-600">{w.description}</p>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader title={selected.name} description={selected.description || undefined} />
      <Card className="max-w-2xl">
        <RequestForm
          key={selected.id}
          form={selected.form}
          submitLabel="Submit request"
          extraActions={
            <Button variant="ghost" onClick={() => setSelectedId(null)}>
              Back
            </Button>
          }
          onSubmit={async ({ title, data }) => {
            const created = await api<{ id: string }>(`/orgs/${orgId}/requests`, {
              method: 'POST',
              body: { workflowId: selected.id, title, data },
            });
            await queryClient.invalidateQueries({ queryKey: orgKey(orgId) });
            router.push(`/o/${orgId}/requests/${created.id}`);
          }}
        />
      </Card>
    </>
  );
}
