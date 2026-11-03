'use client';

import { useState, FormEvent } from 'react';
import { RouteGuard } from '../../../components/RouteGuard';
import { AppShell } from '../../../components/AppShell';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { PageHeader } from '../../../components/ui/PageHeader';
import { inputClass, labelClass } from '../../../components/ui/form';
import { useAuth } from '../../../lib/auth-context';
import { inviteDelegate, assignDelegate } from '../../../lib/api-client';

function DelegatesContent() {
  const { accessToken } = useAuth();
  const token = accessToken as string;

  const [phone, setPhone] = useState('');
  const [invitedId, setInvitedId] = useState<string | null>(null);
  const [delegateId, setDelegateId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [assignStatus, setAssignStatus] = useState<'idle' | 'done' | 'error'>('idle');

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    const { id } = await inviteDelegate(token, phone);
    setInvitedId(id);
    setDelegateId(id);
    setPhone('');
  }

  async function handleAssign(e: FormEvent) {
    e.preventDefault();
    try {
      await assignDelegate(token, delegateId, roomId);
      setAssignStatus('done');
    } catch {
      setAssignStatus('error');
    }
  }

  return (
    <AppShell>
      <PageHeader title="Delegates" description="Invite delegates by phone number and assign each one to a room." />

      <div className="space-y-6">
        <Card title="Invite a delegate">
          <form onSubmit={handleInvite} className="grid gap-4 sm:grid-cols-[2fr_auto] sm:items-end">
            <div>
              <label htmlFor="phone" className={labelClass}>
                Phone number
              </label>
              <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+961..." required className={inputClass} />
            </div>
            <Button type="submit">Invite</Button>
          </form>
          {invitedId && <p className="mt-3 text-sm text-success-700">Invited. Delegate ID: {invitedId}</p>}
        </Card>

        <Card title="Assign to a room">
          <form onSubmit={handleAssign} className="grid gap-4 sm:grid-cols-2 sm:items-end">
            <div>
              <label htmlFor="delegateId" className={labelClass}>
                Delegate ID
              </label>
              <input id="delegateId" value={delegateId} onChange={(e) => setDelegateId(e.target.value)} required className={inputClass} />
            </div>
            <div>
              <label htmlFor="roomId" className={labelClass}>
                Room ID
              </label>
              <input id="roomId" value={roomId} onChange={(e) => setRoomId(e.target.value)} required className={inputClass} />
            </div>
            <Button type="submit" className="sm:col-span-2 sm:w-fit">
              Assign
            </Button>
          </form>
          {assignStatus === 'done' && (
            <p role="status" className="mt-3 text-sm font-medium text-success-700">
              Assigned.
            </p>
          )}
          {assignStatus === 'error' && (
            <p role="alert" className="mt-3 text-sm font-medium text-danger-700">
              Failed to assign.
            </p>
          )}
        </Card>
      </div>
    </AppShell>
  );
}

export default function DelegatesAdminPage() {
  return (
    <RouteGuard>
      <DelegatesContent />
    </RouteGuard>
  );
}
