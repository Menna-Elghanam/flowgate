'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthCard } from '@/components/auth-card';
import { Button, ErrorState, Field, FormError, Input, LoadingState } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

interface InvitePreview {
  orgName: string;
  email: string;
  accountExists: boolean;
}

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api<InvitePreview>(`/invites/${token}`),
  });
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = invite.data?.accountExists ? { password } : { name, password };
      const { orgId } = await api<{ orgId: string }>(`/invites/${token}/accept`, {
        method: 'POST',
        body,
      });
      queryClient.clear();
      router.replace(`/o/${orgId}/inbox`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (invite.isPending)
    return (
      <AuthCard title="Invitation">
        <LoadingState />
      </AuthCard>
    );
  if (invite.isError) {
    return (
      <AuthCard title="Invitation">
        <ErrorState message={`${errorMessage(invite.error)} Ask your admin for a new invite.`} />
      </AuthCard>
    );
  }

  const { orgName, email, accountExists } = invite.data;
  return (
    <AuthCard title={`Join ${orgName}`} subtitle={`You were invited as ${email}.`}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {!accountExists && (
          <Field label="Your name" htmlFor="name">
            <Input
              id="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        )}
        <Field
          label={accountExists ? 'Your password' : 'Choose a password'}
          htmlFor="password"
          hint={
            accountExists
              ? 'You already have an account; confirm it’s you.'
              : 'At least 8 characters'
          }
        >
          <Input
            id="password"
            type="password"
            autoComplete={accountExists ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <FormError message={error} />
        <Button type="submit" busy={busy} className="w-full">
          Join {orgName}
        </Button>
      </form>
    </AuthCard>
  );
}
