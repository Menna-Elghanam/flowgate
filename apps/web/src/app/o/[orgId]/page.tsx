import { redirect } from 'next/navigation';

export default async function OrgHome({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  redirect(`/o/${orgId}/inbox`);
}
