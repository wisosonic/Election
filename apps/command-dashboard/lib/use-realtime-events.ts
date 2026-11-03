'use client';

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { DomainEvent } from '@election/shared-types';
import { addEvent } from './domain-events-reducer';

const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL ?? 'http://localhost:3002';

/** Connects to realtime-service (§5.3) with the HQ access token and
 * accumulates incoming domain events. No token -> no connection attempt. */
export function useRealtimeEvents(token: string | null): { events: DomainEvent[]; connected: boolean } {
  const [events, setEvents] = useState<DomainEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!token) return undefined;

    const socket = io(REALTIME_URL, { auth: { token } });
    socketRef.current = socket;
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('domain-event', (event: DomainEvent) => setEvents((prev) => addEvent(prev, event)));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  return { events, connected };
}
