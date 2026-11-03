'use client';

import { RouteGuard } from '../../components/RouteGuard';
import { AppShell } from '../../components/AppShell';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { BroadcastForm } from '../../components/BroadcastForm';
import { useAuth } from '../../lib/auth-context';

function BroadcastContent() {
  const { accessToken } = useAuth();
  return (
    <AppShell>
      <PageHeader title="Broadcast a Message" description="Send an instruction or alert to every delegate in a room, or a whole qada." />
      <Card>
        <BroadcastForm token={accessToken as string} />
      </Card>
    </AppShell>
  );
}

export default function BroadcastPage() {
  return (
    <RouteGuard>
      <BroadcastContent />
    </RouteGuard>
  );
}
