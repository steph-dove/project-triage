import Link from 'next/link';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-line bg-card px-6 py-20 text-center">
      {children}
    </div>
  );
}

export function NoIntakesYet() {
  return (
    <Shell>
      <span aria-hidden className="size-12 rounded-lg border-2 border-dashed border-line" />
      <h2 className="text-lg font-semibold">No intakes yet</h2>
      <p className="max-w-md text-muted">
        Inbound project requests show up here once they are submitted. Create the first one to
        see how triage works.
      </p>
      <Link
        href="/intakes/new"
        className="mt-2 rounded-md bg-ink px-5 py-3 text-sm font-semibold text-card transition-opacity hover:opacity-90"
      >
        Create your first intake
      </Link>
    </Shell>
  );
}

export function NoFilterMatches({ totalAll, label }: { totalAll: number; label: string }) {
  return (
    <Shell>
      <h2 className="text-lg font-semibold">No intakes match this filter</h2>
      <p className="max-w-md text-muted">
        There are {totalAll} intakes in total, but none with the status {label}.
      </p>
      <Link
        href="/"
        className="mt-2 rounded-md border border-line bg-card px-5 py-3 text-sm font-semibold transition-colors hover:border-faint"
      >
        Clear filter
      </Link>
    </Shell>
  );
}
