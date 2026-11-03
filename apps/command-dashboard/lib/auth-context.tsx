'use client';

import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';

export interface Claims {
  sub: string;
  tenantId: string;
  role: string;
}

/** Decodes the JWT payload for display purposes only (e.g. "signed in as
 * coordinator") -- this is NOT a verification step. The server (command-api's
 * JwtAuthGuard, realtime-service's Socket.IO middleware) is the only actual
 * authority on what a token grants. */
function decodeClaims(token: string): Claims | null {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as Claims;
  } catch {
    return null;
  }
}

interface AuthState {
  accessToken: string | null;
  claims: Claims | null;
  /** False until localStorage has been read on mount. `RouteGuard` waits for
   * this before deciding to redirect -- otherwise an already-logged-in user
   * refreshing a protected page would get briefly bounced to /login before
   * their token loads (accessToken starts `null` on every render until the
   * effect below runs). Public pages (e.g. /login) don't need to check it. */
  isReady: boolean;
  login: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);
const STORAGE_KEY = 'election.accessToken';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) setAccessToken(stored);
    setIsReady(true);
  }, []);

  function login(token: string): void {
    window.localStorage.setItem(STORAGE_KEY, token);
    setAccessToken(token);
  }

  function logout(): void {
    window.localStorage.removeItem(STORAGE_KEY);
    setAccessToken(null);
  }

  const claims = useMemo(() => (accessToken ? decodeClaims(accessToken) : null), [accessToken]);

  // No early `return null` here: accessToken is `null` on both the server
  // render and the client's very first render (before the effect above
  // runs), so there's no hydration-mismatch risk in rendering children
  // immediately -- unlike blocking on `isReady`, which just blanks every
  // page (including public ones like /login) until the effect fires.
  return <AuthContext.Provider value={{ accessToken, claims, isReady, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
