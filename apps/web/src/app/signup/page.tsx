'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthCard } from '@/components/auth-card';
import { Button, Field, FormError, Input } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';

type Fields = 'name' | 'email' | 'password' | 'organizationName';

export default function SignupPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<Fields, string>>({
    name: '',
    email: '',
    password: '',
    organizationName: '',
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Fields, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: Fields) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const { orgId } = await api<{ orgId: string }>('/auth/signup', {
        method: 'POST',
        body: values,
      });
      queryClient.clear();
      router.replace(`/o/${orgId}/workflows`);
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details)) {
        const byField: Partial<Record<Fields, string>> = {};
        for (const issue of err.details as { path: string; message: string }[])
          byField[issue.path as Fields] = issue.message;
        setFieldErrors(byField);
      }
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Create your organization"
      subtitle={
        <>
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-brand-700 underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Your name" htmlFor="name" error={fieldErrors.name}>
          <Input id="name" autoComplete="name" value={values.name} onChange={set('name')} />
        </Field>
        <Field label="Work email" htmlFor="email" error={fieldErrors.email}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={values.email}
            onChange={set('email')}
          />
        </Field>
        <Field
          label="Password"
          htmlFor="password"
          hint="At least 8 characters"
          error={fieldErrors.password}
        >
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={values.password}
            onChange={set('password')}
          />
        </Field>
        <Field label="Organization name" htmlFor="org" error={fieldErrors.organizationName}>
          <Input id="org" value={values.organizationName} onChange={set('organizationName')} />
        </Field>
        <FormError message={error} />
        <Button type="submit" busy={busy} className="w-full">
          Create organization
        </Button>
      </form>
    </AuthCard>
  );
}
