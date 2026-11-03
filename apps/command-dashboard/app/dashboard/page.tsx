'use client';

import { useEffect, useState } from 'react';
import { RouteGuard } from '../../components/RouteGuard';
import { AppShell } from '../../components/AppShell';
import { EventFeed } from '../../components/EventFeed';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { PageHeader } from '../../components/ui/PageHeader';
import { useAuth } from '../../lib/auth-context';
import { useRealtimeEvents } from '../../lib/use-realtime-events';
import { listAllRooms, GeoRow } from '../../lib/api-client';

function DashboardContent() {
  const { accessToken } = useAuth();
  const { events, connected } = useRealtimeEvents(accessToken);
  const [rooms, setRooms] = useState<GeoRow[]>([]);

  useEffect(() => {
    if (!accessToken) return;
    listAllRooms(accessToken)
      .then(setRooms)
      .catch(() => setRooms([]));
  }, [accessToken]);

  return (
    <AppShell>
      <PageHeader title="Live Operations" description="Real-time status across every voting room in your campaign." />

      <div className="mb-6 flex items-center gap-2">
        <Badge tone={connected ? 'success' : 'danger'}>{connected ? 'Live' : 'Disconnected'}</Badge>
        <span className="text-sm text-slate-500">Realtime feed status</span>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title={`Rooms (${rooms.length})`}>
          {rooms.length === 0 ? (
            <p className="text-sm text-slate-400">No rooms yet — set them up under Election Setup.</p>
          ) : (
            <ul className="space-y-1 text-sm text-slate-700">
              {rooms.map((r) => (
                <li key={r.id} className="rounded px-2 py-1 hover:bg-slate-50">
                  {r.label ?? r.id}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Live events">
          <EventFeed events={events} />
        </Card>
      </div>
    </AppShell>
  );
}

export default function DashboardPage() {
  return (
    <RouteGuard>
      <DashboardContent />
    </RouteGuard>
  );
}
