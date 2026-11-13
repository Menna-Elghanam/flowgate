'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ErrorState, LoadingState } from '@/components/ui';
import { useMe } from '@/lib/queries';

/** Sends people to their first organization's inbox (or to login, via the API's 401). */
export default function Home() {
  const router = useRouter();
  const me = useMe();

  useEffect(() => {
    const first = me.data?.organizations[0];
    if (first) router.replace(`/o/${first.id}/inbox`);
  }, [me.data, router]);

  if (me.data && me.data.organizations.length === 0) {
    return (
      <main className="mx-auto max-w-md p-8">
        <ErrorState message="Your account isn't part of any organization. Ask an admin for an invite." />
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-md p-8">
      {me.isError ? (
        <ErrorState message="Could not load your account." onRetry={() => me.refetch()} />
      ) : (
        <LoadingState />
      )}
    </main>
  );
}
