'use client';

import { useState, FormEvent } from 'react';
import { hqLogin, hqVerifyTotp } from '../lib/api-client';
import { Button } from './ui/Button';
import { inputClass, labelClass } from './ui/form';

interface LoginFormProps {
  onLoggedIn: (accessToken: string) => void;
}

/** Two-step HQ login (§6.1): tenant + email + password, then a TOTP code. */
export function LoginForm({ onLoggedIn }: LoginFormProps) {
  const [step, setStep] = useState<'credentials' | 'totp'>('credentials');
  const [tenantId, setTenantId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [pendingId, setPendingId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleCredentialsSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await hqLogin(tenantId, email, password);
      setPendingId(result.pendingId);
      setStep('totp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTotpSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await hqVerifyTotp(pendingId, code);
      onLoggedIn(result.accessToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code');
    } finally {
      setSubmitting(false);
    }
  }

  if (step === 'totp') {
    return (
      <form onSubmit={handleTotpSubmit} className="space-y-4" noValidate>
        <p className="text-sm text-slate-500">Step 2 of 2 — enter the code from your authenticator app.</p>
        <div>
          <label htmlFor="code" className={labelClass}>
            Authentication code
          </label>
          <input
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            className={inputClass}
          />
        </div>
        {error && (
          <p role="alert" className="rounded-md bg-danger-50 px-3 py-2 text-sm text-danger-700">
            {error}
          </p>
        )}
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? 'Verifying…' : 'Verify'}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={handleCredentialsSubmit} className="space-y-4" noValidate>
      <p className="text-sm text-slate-500">Step 1 of 2 — sign in with your campaign credentials.</p>
      <div>
        <label htmlFor="tenantId" className={labelClass}>
          Campaign ID
        </label>
        <input id="tenantId" value={tenantId} onChange={(e) => setTenantId(e.target.value)} required className={inputClass} />
      </div>
      <div>
        <label htmlFor="email" className={labelClass}>
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="password" className={labelClass}>
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          className={inputClass}
        />
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {error}
        </p>
      )}
      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
