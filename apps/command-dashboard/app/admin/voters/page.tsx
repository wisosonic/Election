'use client';

import { useState, FormEvent } from 'react';
import { RouteGuard } from '../../../components/RouteGuard';
import { AppShell } from '../../../components/AppShell';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { PageHeader } from '../../../components/ui/PageHeader';
import { labelClass } from '../../../components/ui/form';
import { useAuth } from '../../../lib/auth-context';
import { importVoters } from '../../../lib/api-client';

const PLACEHOLDER = `{
  "ranges": [{ "roomId": "<room-uuid>", "start": 1000, "end": 1999 }],
  "families": [
    { "registryNumber": 1500, "members": [{ "name": "Jean Dupont", "disambiguation": { "fatherName": "Michel" } }] }
  ]
}`;

/** §5.5: bulk import of family records/members + each room's registry-number
 * range(s). The real registry is supplied by the campaign later (§4.4) --
 * until then this accepts pasted JSON matching command-api's import shape,
 * which is exactly what the seed generator itself produces. */
function VotersContent() {
  const { accessToken } = useAuth();
  const token = accessToken as string;

  const [json, setJson] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'error'>('idle');
  const [result, setResult] = useState<{ imported: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setError(null);
    try {
      const body = JSON.parse(json);
      const response = await importVoters(token, body);
      setResult(response);
      setStatus('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setStatus('error');
    }
  }

  return (
    <AppShell>
      <PageHeader title="Voter Registry Import" description="Paste the registry as JSON — room registry-number ranges plus family records and their member voters." />

      <Card>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="json" className={labelClass}>
              Registry JSON
            </label>
            <textarea
              id="json"
              rows={12}
              value={json}
              onChange={(e) => setJson(e.target.value)}
              placeholder={PLACEHOLDER}
              required
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900 shadow-sm placeholder:text-slate-400 focus-visible:border-brand-600"
            />
          </div>
          {error && (
            <p role="alert" className="rounded-md bg-danger-50 px-3 py-2 text-sm text-danger-700">
              {error}
            </p>
          )}
          <Button type="submit" disabled={status === 'sending'}>
            {status === 'sending' ? 'Importing…' : 'Import'}
          </Button>
        </form>
        {result && (
          <p role="status" className="mt-4 text-sm font-medium text-success-700">
            Imported {result.imported} family record(s).
          </p>
        )}
      </Card>
    </AppShell>
  );
}

export default function VotersAdminPage() {
  return (
    <RouteGuard>
      <VotersContent />
    </RouteGuard>
  );
}
