'use client';

import type { Decision, FormValue } from '@flowgate/workflow';
import { useQueryClient } from '@tanstack/react-query';
import { use, useState } from 'react';
import { RequestForm } from '@/components/request-form';
import { RequestStatusBadge, TaskStatusBadge } from '@/components/status-badge';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  FormError,
  LoadingState,
  PageHeader,
  Textarea,
} from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { actionLabel, formatDate, formatDateTime, isOverdue, relativeTime } from '@/lib/format';
import { orgKey, useRequest } from '@/lib/queries';
import type { RequestDetail, RequestTask } from '@/lib/types';

const DECISION_LABEL: Record<Decision, string> = {
  approve: 'Approve',
  send_back: 'Send back',
  reject: 'Reject',
};

function DecisionPanel({
  orgId,
  request,
  onDone,
}: {
  orgId: string;
  request: RequestDetail;
  onDone: () => Promise<void>;
}) {
  const task = request.myOpenTask;
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!task) return null;

  async function decide(decision: Decision) {
    if (decision !== 'approve' && comment.trim() === '') {
      setError(
        `Please explain why in a comment before you ${decision === 'reject' ? 'reject' : 'send it back'}.`,
      );
      return;
    }
    setBusy(decision);
    setError(null);
    try {
      await api(`/orgs/${orgId}/tasks/${task!.id}/decision`, {
        method: 'POST',
        body: { decision, comment },
      });
      setComment('');
    } catch (err) {
      // A 409 means someone else acted first (or the request moved on): show the new state.
      setError(
        err instanceof ApiError && err.status === 409
          ? `${err.message}. The page now shows the latest state.`
          : errorMessage(err),
      );
    } finally {
      setBusy(null);
      await onDone();
    }
  }

  return (
    <Card className="border-brand-500/40 bg-brand-50/40">
      <h2 className="font-semibold">Your decision: {task.stepName}</h2>
      {task.dueAt && (
        <p className={`mt-1 text-sm ${isOverdue(task.dueAt) ? 'text-red-700' : 'text-slate-600'}`}>
          {isOverdue(task.dueAt) ? 'Overdue since' : 'Due'} {formatDateTime(task.dueAt)}
        </p>
      )}
      <div className="mt-4 space-y-3">
        <Field
          label="Comment"
          htmlFor="decision-comment"
          hint="Required when you reject or send back."
        >
          <Textarea
            id="decision-comment"
            maxLength={2000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </Field>
        <FormError message={error} />
        <div className="flex flex-wrap gap-2">
          {(['approve', 'send_back', 'reject'] as const).map((d) => (
            <Button
              key={d}
              variant={d === 'approve' ? 'primary' : d === 'reject' ? 'danger' : 'secondary'}
              busy={busy === d}
              disabled={busy !== null}
              onClick={() => void decide(d)}
            >
              {DECISION_LABEL[d]}
            </Button>
          ))}
        </div>
      </div>
    </Card>
  );
}

function displayValue(value: FormValue | undefined, type: string): string {
  if (value === null || value === undefined || value === '') return '—';
  if (type === 'date' && typeof value === 'string') return formatDate(value);
  if (typeof value === 'number') return value.toLocaleString();
  return value;
}

/** One block per time a step ran: a step can run again after a send-back and resubmit. */
function groupSteps(tasks: RequestTask[]) {
  const groups = new Map<string, { stepName: string; activation: number; tasks: RequestTask[] }>();
  for (const task of tasks) {
    const key = `${task.stepId}#${task.activation}`;
    const group = groups.get(key) ?? {
      stepName: task.stepName,
      activation: task.activation,
      tasks: [],
    };
    group.tasks.push(task);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export default function RequestPage({
  params,
}: {
  params: Promise<{ orgId: string; requestId: string }>;
}) {
  const { orgId, requestId } = use(params);
  const queryClient = useQueryClient();
  const query = useRequest(orgId, requestId);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: orgKey(orgId) });

  if (query.isPending) return <LoadingState />;
  if (query.isError)
    return <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />;
  const request = query.data;
  const lastSendBack = request.history.findLast((e) => e.action === 'request_sent_back');

  async function withdraw() {
    if (!window.confirm('Withdraw this request? This cannot be undone.')) return;
    setWithdrawing(true);
    setWithdrawError(null);
    try {
      await api(`/orgs/${orgId}/requests/${requestId}/withdraw`, { method: 'POST' });
    } catch (err) {
      setWithdrawError(errorMessage(err));
    } finally {
      setWithdrawing(false);
      await refresh();
    }
  }

  return (
    <>
      <PageHeader
        title={request.title}
        description={`${request.workflow.name} (v${request.workflow.version}) · by ${request.requester.name} · ${formatDateTime(request.createdAt)}`}
        actions={
          <>
            <RequestStatusBadge status={request.status} />
            {request.permissions.canWithdraw && (
              <Button variant="danger" busy={withdrawing} onClick={() => void withdraw()}>
                Withdraw
              </Button>
            )}
          </>
        }
      />
      <FormError message={withdrawError} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {request.status === 'in_progress' && (
            <DecisionPanel orgId={orgId} request={request} onDone={refresh} />
          )}

          {request.permissions.canResubmit ? (
            <Card className="border-amber-300">
              <h2 className="font-semibold">Changes requested</h2>
              {lastSendBack && (
                <p className="mt-1 text-sm text-slate-700">
                  {lastSendBack.actor?.name ?? 'An approver'} at “
                  {String(lastSendBack.details.stepName ?? '')}”:{' '}
                  <span className="italic">{String(lastSendBack.details.comment ?? '')}</span>
                </p>
              )}
              <div className="mt-4">
                <RequestForm
                  form={request.definition.form}
                  initialTitle={request.title}
                  initialData={request.data}
                  submitLabel="Resubmit"
                  onSubmit={async ({ title, data }) => {
                    await api(`/orgs/${orgId}/requests/${requestId}/resubmit`, {
                      method: 'POST',
                      body: { title, data },
                    });
                    await refresh();
                  }}
                />
              </div>
            </Card>
          ) : (
            <Card>
              <h2 className="mb-3 font-semibold">Details</h2>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {request.definition.form.fields.map((field) => (
                  <div
                    key={field.id}
                    className={field.type === 'textarea' ? 'sm:col-span-2' : undefined}
                  >
                    <dt className="text-xs font-medium text-slate-500 uppercase">{field.label}</dt>
                    <dd className="mt-0.5 text-sm whitespace-pre-wrap">
                      {displayValue(request.data[field.id], field.type)}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}

          <Card>
            <h2 className="mb-3 font-semibold">Approval steps</h2>
            {request.tasks.length === 0 ? (
              <p className="text-sm text-slate-600">No approval steps were needed.</p>
            ) : (
              <ol className="space-y-4">
                {groupSteps(request.tasks).map((group) => (
                  <li key={`${group.stepName}-${group.activation}-${group.tasks[0]?.id}`}>
                    <p className="text-sm font-medium">
                      {group.stepName}
                      {group.activation > 1 && (
                        <span className="ml-2 text-xs text-slate-500">
                          (round {group.activation})
                        </span>
                      )}
                    </p>
                    <ul className="mt-2 space-y-2">
                      {group.tasks.map((task) => (
                        <li
                          key={task.id}
                          className="flex flex-wrap items-start justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm"
                        >
                          <div>
                            <p>
                              {task.assignee.name}
                              {task.escalatedFromId && <Badge tone="warning">escalated</Badge>}
                            </p>
                            {task.comment && (
                              <p className="mt-0.5 text-slate-600 italic">“{task.comment}”</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            {task.decidedAt
                              ? relativeTime(task.decidedAt)
                              : task.status === 'pending' && task.dueAt
                                ? `due ${relativeTime(task.dueAt)}`
                                : null}
                            <TaskStatusBadge status={task.status} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <Card className="h-fit">
          <h2 className="mb-3 font-semibold">History</h2>
          <ol className="space-y-3 border-l border-slate-200 pl-4">
            {request.history.map((event) => (
              <li key={event.id} className="text-sm">
                <p>
                  <span className="font-medium">{event.actor?.name ?? 'Flowgate'}</span>{' '}
                  {actionLabel(event.action)}
                  {typeof event.details.stepName === 'string' && (
                    <span className="text-slate-600"> · {event.details.stepName}</span>
                  )}
                </p>
                {typeof event.details.comment === 'string' && (
                  <p className="text-slate-600 italic">“{event.details.comment}”</p>
                )}
                <time
                  dateTime={event.createdAt}
                  className="text-xs text-slate-500"
                  title={formatDateTime(event.createdAt)}
                >
                  {relativeTime(event.createdAt)}
                </time>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
