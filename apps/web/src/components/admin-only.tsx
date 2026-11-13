'use client';

import type { ReactNode } from 'react';
import { useIsAdmin } from '@/lib/queries';
import { ErrorState } from './ui';

/** Hides admin pages from non-admins. The API enforces the same rule on every request. */
export function AdminOnly({ orgId, children }: { orgId: string; children: ReactNode }) {
  return useIsAdmin(orgId) ? (
    <>{children}</>
  ) : (
    <ErrorState message="Only admins can open this page." />
  );
}
