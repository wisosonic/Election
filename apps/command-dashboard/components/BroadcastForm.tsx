'use client';

import { useState, FormEvent } from 'react';
import { broadcastMessage } from '../lib/api-client';
import { Button } from './ui/Button';
import { inputClass, labelClass } from './ui/form';

interface BroadcastFormProps {
  token: string;
}

/** Sends an HQ broadcast to a room or a whole qada (§5.2/§9) -- the "control"
 * half of "real-time monitoring and control." */
export function BroadcastForm({ token }: BroadcastFormProps) {
  const [scopeType, setScopeType] = useState<'room' | 'qada'>('room');
  const [scopeId, setScopeId] = useState('');
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setStatus('sending');
    try {
      const scope = scopeType === 'room' ? { roomId: scopeId } : { qadaId: scopeId };
      await broadcastMessage(token, scope, body);
      setStatus('sent');
      setBody('');
    } catch {
      setStatus('error');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="scopeType" className={labelClass}>
          Send to
        </label>
        <select id="scopeType" value={scopeType} onChange={(e) => setScopeType(e.target.value as 'room' | 'qada')} className={inputClass}>
          <option value="room">A room</option>
          <option value="qada">All rooms in a qada</option>
        </select>
      </div>
      <div>
        <label htmlFor="scopeId" className={labelClass}>
          {scopeType === 'room' ? 'Room ID' : 'Qada ID'}
        </label>
        <input id="scopeId" value={scopeId} onChange={(e) => setScopeId(e.target.value)} required className={inputClass} />
      </div>
      <div>
        <label htmlFor="body" className={labelClass}>
          Message
        </label>
        <textarea id="body" value={body} onChange={(e) => setBody(e.target.value)} required rows={4} className={inputClass} />
      </div>
      <Button type="submit" disabled={status === 'sending'}>
        {status === 'sending' ? 'Sending…' : 'Send broadcast'}
      </Button>
      {status === 'sent' && (
        <p role="status" className="text-sm font-medium text-success-700">
          Sent.
        </p>
      )}
      {status === 'error' && (
        <p role="alert" className="text-sm font-medium text-danger-700">
          Failed to send.
        </p>
      )}
    </form>
  );
}
