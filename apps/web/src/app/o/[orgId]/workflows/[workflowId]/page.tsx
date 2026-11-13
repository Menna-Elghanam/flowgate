'use client';

import { validateDefinition, type WorkflowDefinition, type WorkflowNode } from '@flowgate/workflow';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { use, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { AdminOnly } from '@/components/admin-only';
import { Canvas, type Selection } from '@/components/builder/canvas';
import { FormEditor } from '@/components/builder/form-editor';
import { Inspector } from '@/components/builder/inspector';
import { Badge, Button, Card, cx, ErrorState, Field, Input, LoadingState } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { addNode, type AddableNode, type Updater } from '@/lib/builder';
import { formatDateTime } from '@/lib/format';
import { orgKey, useMembers, useWorkflow } from '@/lib/queries';
import type { Member, PublishIssue, WorkflowDetail } from '@/lib/types';

type Tab = 'flow' | 'form' | 'settings';

const ADD_BUTTONS: { kind: AddableNode; label: string }[] = [
  { kind: 'approval', label: '+ Approval' },
  { kind: 'condition', label: '+ Condition' },
  { kind: 'end_approved', label: '+ End: approved' },
  { kind: 'end_rejected', label: '+ End: rejected' },
];

function Settings({ orgId, workflow }: { orgId: string; workflow: WorkflowDetail }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(workflow.name);
  const [description, setDescription] = useState(workflow.description);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api(`/orgs/${orgId}/workflows/${workflow.id}`, {
        method: 'PATCH',
        body: { name, description },
      });
      await queryClient.invalidateQueries({ queryKey: orgKey(orgId, 'workflows', 'list') });
      setMessage({ ok: true, text: 'Saved.' });
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <h2 className="mb-4 font-semibold">Name and description</h2>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Name" htmlFor="wf-name">
            <Input
              id="wf-name"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Description" htmlFor="wf-description">
            <Input
              id="wf-description"
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          {message && (
            <p
              role={message.ok ? 'status' : 'alert'}
              className={`text-sm ${message.ok ? 'text-emerald-700' : 'text-red-700'}`}
            >
              {message.text}
            </p>
          )}
          <Button type="submit" busy={busy}>
            Save
          </Button>
        </form>
      </Card>
      <Card>
        <h2 className="font-semibold">Versions</h2>
        <p className="mb-3 text-sm text-slate-600">
          Published versions never change. Running requests keep the version they started with.
        </p>
        <ul className="divide-y divide-slate-200 text-sm">
          {workflow.versions.map((v) => (
            <li key={v.id} className="flex items-center justify-between py-2">
              <span>Version {v.version}</span>
              <span className="flex items-center gap-2 text-slate-600">
                {v.publishedAt && formatDateTime(v.publishedAt)}
                {v.isCurrent ? (
                  <Badge tone="success">Live</Badge>
                ) : v.status === 'draft' ? (
                  <Badge tone="warning">Draft</Badge>
                ) : (
                  <Badge>Old</Badge>
                )}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Builder({
  orgId,
  workflow,
  members,
}: {
  orgId: string;
  workflow: WorkflowDetail;
  members: Member[];
}) {
  const queryClient = useQueryClient();
  const initial = (workflow.draft ?? workflow.published)?.definition;
  const [saved, setSaved] = useState<WorkflowDefinition | undefined>(initial);
  const [definition, setDefinition] = useState<WorkflowDefinition | undefined>(initial);
  const [serverIssues, setServerIssues] = useState<PublishIssue[]>(
    workflow.issues.filter((i) => i.code === 'UNKNOWN_USER'),
  );
  const [selection, setSelection] = useState<Selection>(null);
  const [tab, setTab] = useState<Tab>('flow');
  const [busy, setBusy] = useState<'save' | 'publish' | 'discard' | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const update = useCallback((fn: Updater) => setDefinition((d) => (d ? fn(d) : d)), []);
  const dirty = useMemo(
    () => JSON.stringify(definition) !== JSON.stringify(saved),
    [definition, saved],
  );
  const hasDraft = workflow.draft !== null || dirty;

  // Same checks the API runs before publishing, so problems show while drawing.
  const issues: PublishIssue[] = useMemo(
    () => (definition ? [...validateDefinition(definition), ...serverIssues] : []),
    [definition, serverIssues],
  );
  const issueNodeIds = useMemo(
    () => new Set(issues.flatMap((i) => (i.nodeId ? [i.nodeId] : []))),
    [issues],
  );
  const issueEdgeIds = useMemo(
    () => new Set(issues.flatMap((i) => ('edgeId' in i && i.edgeId ? [i.edgeId] : []))),
    [issues],
  );

  const memberNames = useMemo(() => new Map(members.map((m) => [m.userId, m.name])), [members]);
  const describeNode = useCallback(
    (node: WorkflowNode) => {
      if (node.type !== 'approval') return '';
      const { assignee } = node;
      const who =
        assignee.kind === 'manager'
          ? "Requester's manager"
          : assignee.kind === 'role'
            ? `All ${assignee.role}s`
            : assignee.userIds.map((id) => memberNames.get(id) ?? 'Unknown').join(', ') ||
              'Nobody yet';
      const mode = assignee.kind !== 'manager' && node.mode === 'all' ? ' · all must approve' : '';
      return `${who}${mode}${node.dueInHours ? ` · ${node.dueInHours}h` : ''}`;
    },
    [memberNames],
  );

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (!definition) return <ErrorState message="This workflow has no versions." />;

  async function save(): Promise<boolean> {
    setBusy('save');
    setNotice(null);
    try {
      const result = await api<{ issues: PublishIssue[] }>(
        `/orgs/${orgId}/workflows/${workflow.id}/draft`,
        {
          method: 'PUT',
          body: { definition },
        },
      );
      setSaved(definition);
      setServerIssues(result.issues.filter((i) => i.code === 'UNKNOWN_USER'));
      setNotice({ ok: true, text: 'Draft saved.' });
      return true;
    } catch (err) {
      setNotice({ ok: false, text: errorMessage(err) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    if (dirty && !(await save())) return;
    setBusy('publish');
    setNotice(null);
    try {
      const result = await api<{ publishedNow: number }>(
        `/orgs/${orgId}/workflows/${workflow.id}/publish`,
        { method: 'POST' },
      );
      setNotice({
        ok: true,
        text: `Version ${result.publishedNow} is live. New requests will use it.`,
      });
      // Reloading the workflow re-mounts the builder with the published version.
      await queryClient.invalidateQueries({ queryKey: orgKey(orgId, 'workflows') });
    } catch (err) {
      setNotice({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  async function discard() {
    if (!window.confirm('Throw away all unpublished changes and go back to the live version?'))
      return;
    setBusy('discard');
    try {
      if (workflow.draft)
        await api(`/orgs/${orgId}/workflows/${workflow.id}/draft`, { method: 'DELETE' });
      setDefinition(workflow.published?.definition);
      setSaved(workflow.published?.definition);
      await queryClient.invalidateQueries({ queryKey: orgKey(orgId, 'workflows') });
    } catch (err) {
      setNotice({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  const live = workflow.published?.version ?? null;
  const editingVersion = workflow.draft?.version ?? (live ?? 0) + 1;

  return (
    <>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={`/o/${orgId}/workflows`} className="text-sm text-brand-700 hover:underline">
            ← Workflows
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{workflow.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            {live !== null ? (
              <Badge tone="success">Live v{live}</Badge>
            ) : (
              <Badge>Not published</Badge>
            )}
            {hasDraft && <span>Editing draft v{editingVersion}</span>}
            {dirty && <Badge tone="warning">Unsaved changes</Badge>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {live !== null && hasDraft && (
            <Button
              variant="ghost"
              busy={busy === 'discard'}
              disabled={busy !== null}
              onClick={() => void discard()}
            >
              Discard draft
            </Button>
          )}
          <Button
            variant="secondary"
            busy={busy === 'save'}
            disabled={busy !== null || !dirty}
            onClick={() => void save()}
          >
            Save draft
          </Button>
          <Button
            busy={busy === 'publish'}
            disabled={busy !== null || issues.length > 0 || !hasDraft}
            title={issues.length > 0 ? 'Fix the problems listed first' : undefined}
            onClick={() => void publish()}
          >
            Publish
          </Button>
        </div>
      </header>

      {notice && (
        <p
          role={notice.ok ? 'status' : 'alert'}
          className={cx(
            'mb-4 rounded-md px-3 py-2 text-sm',
            notice.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800',
          )}
        >
          {notice.text}
        </p>
      )}

      <div
        role="tablist"
        aria-label="Builder sections"
        className="mb-4 flex gap-1 border-b border-slate-200"
      >
        {(
          [
            ['flow', 'Flow'],
            ['form', `Form (${definition.form.fields.length})`],
            ['settings', 'Settings & versions'],
          ] as const
        ).map(([value, label]) => (
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
            {label}
          </button>
        ))}
      </div>

      {tab === 'settings' ? (
        <Settings orgId={orgId} workflow={workflow} />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
          <div className="min-w-0">
            {tab === 'flow' ? (
              <>
                <div className="mb-2 flex flex-wrap gap-2">
                  {ADD_BUTTONS.map(({ kind, label }) => (
                    <Button
                      key={kind}
                      variant="secondary"
                      onClick={() => {
                        const result = addNode(definition, kind);
                        update(() => result.definition);
                        setSelection({ kind: 'node', id: result.id });
                      }}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                <Canvas
                  definition={definition}
                  update={update}
                  selection={selection}
                  setSelection={setSelection}
                  issueNodeIds={issueNodeIds}
                  issueEdgeIds={issueEdgeIds}
                  describeNode={describeNode}
                />
              </>
            ) : (
              <FormEditor definition={definition} update={update} />
            )}
          </div>

          <div className="space-y-6">
            {tab === 'flow' && (
              <Card>
                <Inspector
                  definition={definition}
                  selection={selection}
                  members={members}
                  update={update}
                  clearSelection={() => setSelection(null)}
                />
              </Card>
            )}
            <Card>
              <h2 className="mb-2 font-semibold">
                {issues.length === 0 ? 'Ready to publish' : `Problems (${issues.length})`}
              </h2>
              {issues.length === 0 ? (
                <p className="text-sm text-emerald-700">No problems found.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {issues.map((issue, i) => {
                    const edgeId = 'edgeId' in issue ? issue.edgeId : undefined;
                    const target: Selection = issue.nodeId
                      ? { kind: 'node', id: issue.nodeId }
                      : edgeId
                        ? { kind: 'edge', id: edgeId }
                        : null;
                    return (
                      <li key={`${issue.code}-${i}`}>
                        <button
                          type="button"
                          className="text-left text-red-800 hover:underline"
                          onClick={() => {
                            if (target) {
                              setTab('flow');
                              setSelection(target);
                            } else if ('fieldId' in issue && issue.fieldId) {
                              setTab('form');
                            }
                          }}
                        >
                          {issue.message}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

function BuilderLoader({ orgId, workflowId }: { orgId: string; workflowId: string }) {
  const workflow = useWorkflow(orgId, workflowId);
  const members = useMembers(orgId);
  if (workflow.isPending || members.isPending) return <LoadingState />;
  if (workflow.isError)
    return <ErrorState message={errorMessage(workflow.error)} onRetry={() => workflow.refetch()} />;
  if (members.isError)
    return <ErrorState message={errorMessage(members.error)} onRetry={() => members.refetch()} />;
  // Background refetches (live updates, saving) must not wipe local edits, so the builder
  // only starts fresh when a new version goes live. Discarding a draft resets it directly.
  return (
    <Builder
      key={workflow.data.published?.id ?? 'unpublished'}
      orgId={orgId}
      workflow={workflow.data}
      members={members.data}
    />
  );
}

export default function WorkflowBuilderPage({
  params,
}: {
  params: Promise<{ orgId: string; workflowId: string }>;
}) {
  const { orgId, workflowId } = use(params);
  return (
    <AdminOnly orgId={orgId}>
      <BuilderLoader orgId={orgId} workflowId={workflowId} />
    </AdminOnly>
  );
}
