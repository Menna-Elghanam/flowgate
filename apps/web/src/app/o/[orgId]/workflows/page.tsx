'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useState, type FormEvent } from 'react';
import { AdminOnly } from '@/components/admin-only';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  Input,
  LoadingState,
  PageHeader,
} from '@/components/ui';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { orgKey, useWorkflows } from '@/lib/queries';

function CreateWorkflow({ orgId }: { orgId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const created = await api<{ id: string }>(`/orgs/${orgId}/workflows`, {
        method: 'POST',
        body: { name, description },
      });
      await queryClient.invalidateQueries({ queryKey: orgKey(orgId, 'workflows') });
      router.push(`/o/${orgId}/workflows/${created.id}`);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-4 font-semibold">New workflow</h2>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field
          label="Name"
          htmlFor="wf-name"
          hint="What employees pick, e.g. “Purchase request”"
          error={errors.name}
        >
          <Input
            id="wf-name"
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Description (optional)" htmlFor="wf-description" error={errors.description}>
          <Input
            id="wf-description"
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <FormError message={error} />
        <Button type="submit" busy={busy}>
          Create and open builder
        </Button>
      </form>
    </Card>
  );
}

function WorkflowList({ orgId }: { orgId: string }) {
  const workflows = useWorkflows(orgId);
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        {workflows.isPending ? (
          <LoadingState />
        ) : workflows.isError ? (
          <ErrorState message={errorMessage(workflows.error)} onRetry={() => workflows.refetch()} />
        ) : workflows.data.length === 0 ? (
          <EmptyState title="No workflows yet">
            Create one to turn an approval process into a form and a flow.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
            {workflows.data.map((w) => (
              <li key={w.id}>
                <Link
                  href={`/o/${orgId}/workflows/${w.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{w.name}</p>
                    <p className="text-sm text-slate-600">
                      {w.openRequests} open request{w.openRequests === 1 ? '' : 's'} · edited{' '}
                      {relativeTime(w.updatedAt)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {w.publishedVersion !== null ? (
                      <Badge tone="success">Live v{w.publishedVersion}</Badge>
                    ) : (
                      <Badge>Not published</Badge>
                    )}
                    {w.hasDraft && <Badge tone="warning">Draft</Badge>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <CreateWorkflow orgId={orgId} />
    </div>
  );
}

export default function WorkflowsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = use(params);
  return (
    <>
      <PageHeader
        title="Workflows"
        description="Request forms and the approval flow behind each one."
      />
      <AdminOnly orgId={orgId}>
        <WorkflowList orgId={orgId} />
      </AdminOnly>
    </>
  );
}
