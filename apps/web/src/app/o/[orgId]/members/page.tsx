'use client';

import { ROLES, type Role } from '@flowgate/workflow';
import { useQueryClient } from '@tanstack/react-query';
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
  Select,
} from '@/components/ui';
import { api, errorMessage, fieldErrors } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { orgKey, useInvites, useMe, useMembers } from '@/lib/queries';
import type { Invite, Member } from '@/lib/types';

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  approver: 'Approver',
  employee: 'Employee',
};

function RolePicker({
  value,
  onChange,
  idPrefix,
}: {
  value: Role[];
  onChange: (roles: Role[]) => void;
  idPrefix: string;
}) {
  return (
    <fieldset className="flex flex-wrap gap-3">
      <legend className="sr-only">Roles</legend>
      {ROLES.map((role) => (
        <label
          key={role}
          htmlFor={`${idPrefix}-${role}`}
          className="flex items-center gap-1.5 text-sm"
        >
          <input
            id={`${idPrefix}-${role}`}
            type="checkbox"
            checked={value.includes(role)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, role] : value.filter((r) => r !== role))
            }
          />
          {ROLE_LABEL[role]}
        </label>
      ))}
    </fieldset>
  );
}

function MemberRow({
  orgId,
  member,
  members,
  isMe,
}: {
  orgId: string;
  member: Member;
  members: Member[];
  isMe: boolean;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      await queryClient.invalidateQueries({ queryKey: orgKey(orgId) });
    }
  }

  const update = (body: { roles?: Role[]; managerId?: string | null }) =>
    run(() => api(`/orgs/${orgId}/members/${member.userId}`, { method: 'PATCH', body }));

  return (
    <tr className="align-top">
      <td className="px-4 py-3">
        <p className="font-medium">
          {member.name} {isMe && <Badge>you</Badge>}
        </p>
        <p className="text-xs text-slate-500">{member.email}</p>
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-700">
            {error}
          </p>
        )}
      </td>
      <td className="px-4 py-3">
        <RolePicker
          idPrefix={`member-${member.userId}`}
          value={member.roles}
          onChange={(roles) => {
            if (roles.length === 0) setError('A member needs at least one role.');
            else void update({ roles });
          }}
        />
      </td>
      <td className="px-4 py-3">
        <Select
          aria-label={`Manager of ${member.name}`}
          disabled={busy}
          value={member.managerId ?? ''}
          onChange={(e) => void update({ managerId: e.target.value || null })}
        >
          <option value="">No manager</option>
          {members
            .filter((m) => m.userId !== member.userId)
            .map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
        </Select>
      </td>
      <td className="px-4 py-3 text-right">
        {!isMe && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Remove ${member.name} from the organization?`)) {
                void run(() =>
                  api(`/orgs/${orgId}/members/${member.userId}`, { method: 'DELETE' }),
                );
              }
            }}
          >
            Remove
          </Button>
        )}
      </td>
    </tr>
  );
}

function InviteForm({ orgId, members }: { orgId: string; members: Member[] }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [roles, setRoles] = useState<Role[]>(['employee']);
  const [managerId, setManagerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<Invite | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const invite = await api<Invite>(`/orgs/${orgId}/invites`, {
        method: 'POST',
        body: { email, roles, managerId: managerId || null },
      });
      setCreated(invite);
      setEmail('');
      await queryClient.invalidateQueries({ queryKey: orgKey(orgId, 'invites') });
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-4 font-semibold">Invite someone</h2>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Email" htmlFor="invite-email" error={errors.email}>
          <Input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <div className="space-y-1">
          <p className="text-sm font-medium text-slate-700">Roles</p>
          <RolePicker idPrefix="invite-role" value={roles} onChange={setRoles} />
          {errors.roles && <p className="text-xs text-red-700">{errors.roles}</p>}
        </div>
        <Field label="Manager" htmlFor="invite-manager" hint="Used by “manager approval” steps.">
          <Select
            id="invite-manager"
            value={managerId}
            onChange={(e) => setManagerId(e.target.value)}
          >
            <option value="">No manager</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <FormError message={error} />
        <Button type="submit" busy={busy}>
          Send invite
        </Button>
      </form>
      {created?.link && (
        <div className="mt-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-900" role="status">
          <p>Invite sent to {created.email}. You can also share this link (shown once):</p>
          <code className="mt-1 block break-all">{created.link}</code>
        </div>
      )}
    </Card>
  );
}

function PendingInvites({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const invites = useInvites(orgId);
  const [error, setError] = useState<string | null>(null);

  async function revoke(id: string) {
    setError(null);
    try {
      await api(`/orgs/${orgId}/invites/${id}`, { method: 'DELETE' });
    } catch (err) {
      setError(errorMessage(err));
    }
    await queryClient.invalidateQueries({ queryKey: orgKey(orgId, 'invites') });
  }

  return (
    <Card>
      <h2 className="mb-3 font-semibold">Pending invites</h2>
      <FormError message={error} />
      {invites.isPending ? (
        <LoadingState />
      ) : invites.isError ? (
        <ErrorState message={errorMessage(invites.error)} onRetry={() => invites.refetch()} />
      ) : invites.data.length === 0 ? (
        <p className="text-sm text-slate-600">No open invites.</p>
      ) : (
        <ul className="divide-y divide-slate-200">
          {invites.data.map((invite) => (
            <li key={invite.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div>
                <p>{invite.email}</p>
                <p className="text-xs text-slate-500">
                  {invite.roles.map((r) => ROLE_LABEL[r]).join(', ')} · expires{' '}
                  {formatDateTime(invite.expiresAt)}
                </p>
              </div>
              <Button variant="ghost" onClick={() => void revoke(invite.id)}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Members({ orgId }: { orgId: string }) {
  const me = useMe();
  const members = useMembers(orgId);

  if (members.isPending) return <LoadingState />;
  if (members.isError)
    return <ErrorState message={errorMessage(members.error)} onRetry={() => members.refetch()} />;

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="xl:col-span-2">
        {members.data.length === 0 ? (
          <EmptyState title="No members" />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600 uppercase">
                <tr>
                  <th className="px-4 py-2 font-medium">Member</th>
                  <th className="px-4 py-2 font-medium">Roles</th>
                  <th className="px-4 py-2 font-medium">Manager</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {members.data.map((m) => (
                  <MemberRow
                    key={m.userId}
                    orgId={orgId}
                    member={m}
                    members={members.data}
                    isMe={m.userId === me.data?.user.id}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="space-y-6">
        <InviteForm orgId={orgId} members={members.data} />
        <PendingInvites orgId={orgId} />
      </div>
    </div>
  );
}

export default function MembersPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = use(params);
  return (
    <>
      <PageHeader
        title="Members"
        description="Who is in the organization, their roles and their manager."
      />
      <AdminOnly orgId={orgId}>
        <Members orgId={orgId} />
      </AdminOnly>
    </>
  );
}
