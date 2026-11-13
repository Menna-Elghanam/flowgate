'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useMe, useOrg } from '@/lib/queries';
import { useLiveUpdates } from '@/lib/realtime';
import { cx, ErrorState, LoadingState } from './ui';

interface NavItem {
  href: string;
  label: string;
  adminOnly?: boolean;
}

export function AppShell({ orgId, children }: { orgId: string; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useMe();
  const org = useOrg(orgId);
  const live = useLiveUpdates(orgId);

  const isAdmin = org.data?.myRoles.includes('admin') ?? false;
  const base = `/o/${orgId}`;
  const nav: NavItem[] = [
    { href: `${base}/inbox`, label: 'Inbox' },
    { href: `${base}/requests`, label: 'My requests' },
    { href: `${base}/dashboard`, label: 'Dashboard', adminOnly: true },
    { href: `${base}/workflows`, label: 'Workflows', adminOnly: true },
    { href: `${base}/members`, label: 'Members', adminOnly: true },
    { href: `${base}/audit`, label: 'Audit log', adminOnly: true },
  ];

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    queryClient.clear();
    router.replace('/login');
  }

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <aside className="border-b border-slate-200 bg-white md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex items-center justify-between px-4 py-4 md:block">
          <Link href={`${base}/inbox`} className="text-lg font-semibold text-brand-700">
            Flowgate
          </Link>
          {me.data && me.data.organizations.length > 1 ? (
            <select
              aria-label="Switch organization"
              className="mt-0 rounded-md border border-slate-300 px-2 py-1 text-sm md:mt-3 md:w-full"
              value={orgId}
              onChange={(e) => router.push(`/o/${e.target.value}/inbox`)}
            >
              {me.data.organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-slate-600 md:mt-1">{org.data?.name}</p>
          )}
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:pb-4">
          {nav
            .filter((item) => !item.adminOnly || isAdmin)
            .map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'rounded-md px-3 py-2 text-sm whitespace-nowrap',
                    active
                      ? 'bg-brand-50 font-medium text-brand-700'
                      : 'text-slate-700 hover:bg-slate-100',
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
        </nav>
        <div className="hidden border-t border-slate-200 px-4 py-4 text-sm md:block">
          <p className="font-medium">{me.data?.user.name}</p>
          <p className="truncate text-slate-500">{me.data?.user.email}</p>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
            <span
              aria-hidden
              className={cx('h-2 w-2 rounded-full', live ? 'bg-emerald-500' : 'bg-slate-300')}
            />
            {live ? 'Live updates on' : 'Connecting…'}
          </p>
          <button
            type="button"
            onClick={logout}
            className="mt-3 text-slate-600 underline hover:text-slate-900"
          >
            Log out
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">
        {org.isPending ? (
          <LoadingState />
        ) : org.isError ? (
          <ErrorState
            message={
              org.error instanceof ApiError &&
              (org.error.status === 403 || org.error.status === 404)
                ? "This organization doesn't exist or you're not a member."
                : errorMessage(org.error)
            }
            onRetry={() => org.refetch()}
          />
        ) : (
          children
        )}
      </main>
    </div>
  );
}
