import { STATUS_LABELS } from '@/lib/status';
import type { TriageStatus } from '@/lib/schemas';

// Four statuses that have to be told apart at a glance down a long list, so Accepted gets a
// deeper green than In review and Declined a warm clay rather than another grey.
const STATUS_STYLES: Record<TriageStatus, string> = {
  NEW: 'bg-stone text-stone-ink',
  IN_REVIEW: 'bg-sage text-sage-ink',
  ACCEPTED: 'bg-moss text-moss-ink',
  DECLINED: 'bg-clay text-clay-ink',
};

export function StatusBadge({ status }: { status: TriageStatus }) {
  return (
    <span
      className={`rounded px-2 py-1 text-xs font-medium whitespace-nowrap ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export function TagChip({ label }: { label: string }) {
  return (
    <span className="rounded border border-line bg-card px-2 py-1 font-mono text-xs text-stone-ink">
      {label}
    </span>
  );
}

export function AnalysingPill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded bg-clay px-2 py-1 font-mono text-xs font-semibold tracking-wide text-rust uppercase">
      <span className="size-1.5 rounded-full bg-rust" />
      Analysing
    </span>
  );
}

export function BasicAnalysisChip() {
  return (
    <span className="rounded bg-amber px-2 py-1 font-mono text-xs font-semibold tracking-wide text-amber-ink uppercase">
      Basic analysis
    </span>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`block rounded bg-line [animation:pulse-soft_1.8s_ease-in-out_infinite] ${className}`}
    />
  );
}
