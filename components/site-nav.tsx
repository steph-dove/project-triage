'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ExportButton } from './export-button';

const tabClass = (active: boolean) =>
  `border-b-2 pb-1 text-sm font-medium ${
    active ? 'border-rust text-ink' : 'border-transparent text-muted hover:text-ink'
  }`;

export function SiteNav() {
  const onDashboard = usePathname().startsWith('/dashboard');

  return (
    <>
      <nav className="hidden gap-6 sm:flex">
        <Link href="/" aria-current={onDashboard ? undefined : 'page'} className={tabClass(!onDashboard)}>
          Intakes
        </Link>
        <Link
          href="/dashboard"
          aria-current={onDashboard ? 'page' : undefined}
          className={tabClass(onDashboard)}
        >
          Dashboard
        </Link>
      </nav>

      {/* The phone layout has no room for tabs, so it links to whichever page you are not on. */}
      <Link href={onDashboard ? '/' : '/dashboard'} className="ml-auto text-sm text-muted sm:hidden">
        {onDashboard ? 'Intakes' : 'Dashboard'}
      </Link>

      {onDashboard ? (
        <ExportButton className="ml-auto hidden sm:block" />
      ) : (
        <Link
          href="/intakes/new"
          className="ml-auto hidden rounded-md bg-ink px-4 py-2 text-sm font-semibold text-card transition-opacity hover:opacity-90 sm:block"
        >
          New intake
        </Link>
      )}
    </>
  );
}
