'use client';

import { useRouter } from 'next/navigation';
import { LoginForm } from '../../components/LoginForm';
import { useAuth } from '../../lib/auth-context';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();

  return (
    <main id="main-content" className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <span aria-hidden className="mx-auto mb-3 block h-10 w-10 rounded-lg bg-brand-700" />
          <h1 className="text-lg font-semibold text-slate-900">Campaign HQ Sign In</h1>
          <p className="mt-1 text-sm text-slate-500">Access your campaign&apos;s live operations dashboard.</p>
        </div>
        <LoginForm
          onLoggedIn={(token) => {
            login(token);
            router.replace('/dashboard');
          }}
        />
      </div>
    </main>
  );
}
