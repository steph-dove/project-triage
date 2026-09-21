import Link from 'next/link';
import type { SerializedIntake } from '@/lib/intakes';
import { relativeTime } from '@/lib/time';
import { BasicAnalysisChip, PendingPill, Skeleton, StatusBadge, TagChip } from './badges';

export function IntakeCard({ intake }: { intake: SerializedIntake }) {
  return (
    <Link
      href={`/intakes/${intake.id}`}
      className="block rounded-lg border border-line bg-card p-5 transition-colors hover:border-faint"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-serif text-lg font-semibold">{intake.title}</h2>
          <p className="mt-1 text-sm text-muted">
            {intake.industry} · {intake.budgetRange}
            <span className="hidden sm:inline"> · {intake.timeline}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <StatusBadge status={intake.status} />
          <span className="hidden text-sm text-faint sm:block">
            {relativeTime(intake.createdAt)}
          </span>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <AnalysisSummary intake={intake} />
      </div>
    </Link>
  );
}

// The row never goes blank: every enrichment state has something to show here, because a card
// with an empty third line reads as a rendering bug rather than as work in progress.
function AnalysisSummary({ intake }: { intake: SerializedIntake }) {
  const { enrichment, tags } = intake;
  if (!enrichment) return null;

  if (enrichment.state === 'PENDING' || enrichment.state === 'PROCESSING') {
    return (
      <>
        <PendingPill state={enrichment.state} />
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-6 w-16" />
      </>
    );
  }

  if (enrichment.state === 'FAILED') {
    return (
      <span className="rounded bg-clay px-2 py-1 font-mono text-xs font-semibold tracking-wide text-clay-ink uppercase">
        Analysis failed
      </span>
    );
  }

  return (
    <>
      {tags.map((tag) => (
        <TagChip key={tag} label={tag} />
      ))}
      {enrichment.source === 'FALLBACK' && <BasicAnalysisChip />}
    </>
  );
}
