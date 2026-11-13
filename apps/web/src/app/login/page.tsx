'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { AuthCard } from '@/components/auth-card';
import { Button, Field, FormError, Input } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/login', { method: 'POST', body: { email, password } });
      queryClient.clear();
      const next = params.get('next');
      // Only follow local paths, never a full URL someone put in the link.
      router.replace(next?.startsWith('/') && !next.startsWith('//') ? next : '/');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Field label="Email" htmlFor="email">
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <FormError message={error} />
      <Button type="submit" busy={busy} className="w-full">
        Log in
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <AuthCard
      title="Log in"
      subtitle={
        <>
          New here?{' '}
          <Link href="/signup" className="font-medium text-brand-700 underline">
            Create an organization
          </Link>
        </>
      }
    >
      <Suspense>
        <LoginForm />
      </Suspense>
      <p className="mt-6 rounded-md bg-slate-50 p-3 text-xs text-slate-600">
        Demo: <code>alex@acme.test</code> (admin), <code>maria@acme.test</code> (manager) or{' '}
        <code>emma@acme.test</code> (employee), password <code>flowgate-demo</code>.
      </p>
    </AuthCard>
  );
}
