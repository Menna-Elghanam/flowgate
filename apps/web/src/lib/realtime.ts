'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { orgKey } from './queries';

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Listens for "something changed" notices and refetches the organization's data. The
 * notice carries no data itself, so everything shown still comes through the API's
 * permission checks.
 */
export function useLiveUpdates(orgId: string): boolean {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = io(SOCKET_URL, { withCredentials: true, transports: ['websocket'] });
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('changed', (notice: { orgId: string }) => {
      if (notice.orgId === orgId) void queryClient.invalidateQueries({ queryKey: orgKey(orgId) });
    });
    return () => {
      socket.close();
    };
  }, [orgId, queryClient]);

  return connected;
}
