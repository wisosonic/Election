import { ReactNode } from 'react';
import { Nav } from './Nav';

/** The one layout every authenticated page uses -- nav + a consistent
 * content container -- instead of each page hand-rolling its own wrapper. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <Nav />
      <main id="main-content" className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
