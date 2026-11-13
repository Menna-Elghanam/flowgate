import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';

export default async function OrgLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  return <AppShell orgId={orgId}>{children}</AppShell>;
}
