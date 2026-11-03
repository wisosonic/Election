'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '../lib/auth-context';
import { Button } from './ui/Button';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/admin/geo', label: 'Election Setup' },
  { href: '/admin/delegates', label: 'Delegates' },
  { href: '/admin/voters', label: 'Voter Registry' },
  { href: '/broadcast', label: 'Broadcast' },
] as const;

/** Responsive header: a horizontal nav on desktop, a collapsible menu on
 * narrow screens, with the current page highlighted for orientation. */
export function Nav() {
  const { claims, logout } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/dashboard" className="flex items-center gap-2 text-base font-semibold text-brand-800 no-underline hover:no-underline">
          <span aria-hidden className="inline-block h-6 w-6 rounded bg-brand-700" />
          Campaign HQ
        </Link>

        <button
          type="button"
          className="ml-auto inline-flex items-center rounded-md p-2 text-slate-600 hover:bg-slate-100 md:hidden"
          aria-expanded={open}
          aria-controls="primary-navigation"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((v) => !v)}
        >
          <svg aria-hidden viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2}>
            {open ? <path d="M6 6l12 12M18 6l-12 12" strokeLinecap="round" /> : <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />}
          </svg>
        </button>

        <nav
          id="primary-navigation"
          aria-label="Primary"
          className={`${
            open ? 'absolute inset-x-0 top-full flex flex-col gap-1 border-b border-slate-200 bg-white p-4 shadow-md' : 'hidden'
          } md:static md:flex md:flex-row md:items-center md:gap-1 md:border-0 md:bg-transparent md:p-0 md:shadow-none`}
        >
          {LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                aria-current={active ? 'page' : undefined}
                className={`rounded-md px-3 py-2 text-sm font-medium no-underline hover:no-underline ${
                  active ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {link.label}
              </Link>
            );
          })}

          {/* Reachable from both the mobile dropdown and the desktop row --
              not a separate `md:flex`-only block, which would hide it on mobile. */}
          <div className="mt-2 flex items-center gap-3 border-t border-slate-200 pt-2 md:ml-auto md:mt-0 md:border-0 md:pt-0">
            <span className="text-sm text-slate-500">{claims?.role}</span>
            <Button variant="secondary" onClick={logout}>
              Sign out
            </Button>
          </div>
        </nav>
      </div>
    </header>
  );
}
