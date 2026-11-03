'use client';

import { useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth-context';

/** Client-side route guard: redirects to /login once we know for sure
 * there's no token. Auth state lives client-side (see lib/auth-context.tsx),
 * so this is a plain effect rather than Next middleware. Waits for
 * `isReady` before redirecting -- otherwise an already-logged-in user
 * refreshing this page would get bounced to /login for the brief instant
 * before their token loads from localStorage. */
export function RouteGuard({ children }: { children: ReactNode }) {
  const { accessToken, isReady } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isReady && !accessToken) router.replace('/login');
  }, [isReady, accessToken, router]);

  if (!accessToken) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50" role="status" aria-live="polite">
        <p className="text-sm text-slate-500">{isReady ? 'Redirecting to sign in…' : 'Loading…'}</p>
      </div>
    );
  }
  return <>{children}</>;
}
