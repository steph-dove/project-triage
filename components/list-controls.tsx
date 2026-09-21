import Link from 'next/link';
import type { StatusCounts } from '@/lib/intakes';
import { TRIAGE_STATUSES, type TriageStatus } from '@/lib/schemas';
import { STATUS_LABELS } from '@/lib/status';

// Switching filter always lands on page 1: page 3 of the unfiltered list is rarely page 3 of
// the filtered one, and an empty page would look like the filter matched nothing.
const filterHref = (status?: TriageStatus) => (status ? `/?status=${status}` : '/');

export function FilterChips({
  counts,
  totalAll,
  active,
}: {
  counts: StatusCounts;
  totalAll: number;
  active?: TriageStatus;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Chip href={filterHref()} label="All" count={totalAll} active={active === undefined} />
      {TRIAGE_STATUSES.map((status) => (
        <Chip
          key={status}
          href={filterHref(status)}
          label={STATUS_LABELS[status]}
          count={counts[status]}
          active={active === status}
        />
      ))}
    </div>
  );
}

function Chip({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? 'border-ink bg-ink text-card'
          : 'border-line bg-card text-ink hover:border-faint'
      }`}
    >
      {label} {count}
    </Link>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  status,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  status?: TriageStatus;
}) {
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  const pageHref = (target: number) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (target > 1) params.set('page', String(target));
    const query = params.toString();
    return query ? `/?${query}` : '/';
  };

  return (
    <div className="flex flex-col items-center justify-between gap-4 pt-2 sm:flex-row">
      <p className="text-sm text-muted">
        Showing {first}–{last} of {total}
      </p>
      <div className="flex items-center gap-3">
        <PageLink href={pageHref(page - 1)} disabled={page <= 1}>
          Previous
        </PageLink>
        <span className="text-sm text-muted">
          Page {page} of {totalPages}
        </span>
        <PageLink href={pageHref(page + 1)} disabled={page >= totalPages}>
          Next
        </PageLink>
      </div>
    </div>
  );
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const className = 'rounded-md border border-line px-4 py-2 text-sm font-medium';

  if (disabled) {
    return <span className={`${className} bg-paper text-faint`}>{children}</span>;
  }

  return (
    <Link href={href} className={`${className} bg-card transition-colors hover:border-faint`}>
      {children}
    </Link>
  );
}
