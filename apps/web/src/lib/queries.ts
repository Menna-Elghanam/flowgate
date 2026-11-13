'use client';

import { useQuery } from '@tanstack/react-query';
import type { RequestStatus } from '@flowgate/workflow';
import { api } from './api';
import type {
  AvailableWorkflow,
  Dashboard,
  InboxTask,
  Invite,
  Me,
  Member,
  OrgInfo,
  RequestDetail,
  RequestSummary,
  WorkflowDetail,
  WorkflowSummary,
} from './types';

/** All data of one organization lives under this key, so a live update can refresh it at once. */
export const orgKey = (orgId: string, ...rest: unknown[]) => ['org', orgId, ...rest];

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me') });

export const useOrg = (orgId: string) =>
  useQuery({ queryKey: orgKey(orgId, 'info'), queryFn: () => api<OrgInfo>(`/orgs/${orgId}`) });

export function useIsAdmin(orgId: string): boolean {
  return useOrg(orgId).data?.myRoles.includes('admin') ?? false;
}

export const useInbox = (orgId: string, status: 'open' | 'done') =>
  useQuery({
    queryKey: orgKey(orgId, 'tasks', status),
    queryFn: () => api<InboxTask[]>(`/orgs/${orgId}/tasks?status=${status}`),
  });

export const useRequests = (orgId: string, scope: 'mine' | 'all', status: RequestStatus | '') =>
  useQuery({
    queryKey: orgKey(orgId, 'requests', scope, status),
    queryFn: () => {
      const query = new URLSearchParams({ scope });
      if (status) query.set('status', status);
      return api<RequestSummary[]>(`/orgs/${orgId}/requests?${query.toString()}`);
    },
  });

export const useRequest = (orgId: string, requestId: string) =>
  useQuery({
    queryKey: orgKey(orgId, 'request', requestId),
    queryFn: () => api<RequestDetail>(`/orgs/${orgId}/requests/${requestId}`),
  });

export const useAvailableWorkflows = (orgId: string) =>
  useQuery({
    queryKey: orgKey(orgId, 'workflows', 'available'),
    queryFn: () => api<AvailableWorkflow[]>(`/orgs/${orgId}/workflows/available`),
  });

export const useWorkflows = (orgId: string) =>
  useQuery({
    queryKey: orgKey(orgId, 'workflows', 'list'),
    queryFn: () => api<WorkflowSummary[]>(`/orgs/${orgId}/workflows`),
  });

export const useWorkflow = (orgId: string, workflowId: string) =>
  useQuery({
    queryKey: orgKey(orgId, 'workflows', 'detail', workflowId),
    queryFn: () => api<WorkflowDetail>(`/orgs/${orgId}/workflows/${workflowId}`),
    // The builder holds unsaved edits locally; a background refetch must not reset them.
    refetchOnWindowFocus: false,
  });

export const useMembers = (orgId: string, enabled = true) =>
  useQuery({
    queryKey: orgKey(orgId, 'members'),
    queryFn: () => api<Member[]>(`/orgs/${orgId}/members`),
    enabled,
  });

export const useInvites = (orgId: string) =>
  useQuery({
    queryKey: orgKey(orgId, 'invites'),
    queryFn: () => api<Invite[]>(`/orgs/${orgId}/invites`),
  });

export const useDashboard = (orgId: string) =>
  useQuery({
    queryKey: orgKey(orgId, 'dashboard'),
    queryFn: () => api<Dashboard>(`/orgs/${orgId}/dashboard`),
  });
