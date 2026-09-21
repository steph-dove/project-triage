import { notFound } from 'next/navigation';
import { Block } from '@/components/analysis-blocks';
import { TagChip } from '@/components/badges';
import { BackToIntakes } from '@/components/back-link';
import { LiveAnalysis } from '@/components/live-analysis';
import { RetryButton } from '@/components/retry-button';
import { getIntake, type SerializedIntake } from '@/lib/intakes';
import { relativeTime } from '@/lib/time';
import { StatusButtons } from './status-buttons';

type Enrichment = NonNullable<SerializedIntake['enrichment']>;

const attemptCount = (n: number) => `${n} attempt${n === 1 ? '' : 's'}`;

// No loading.tsx or Suspense here: in production builds they sometimes made the router drop
// router.refresh(), leaving a finished analysis on the live stepper.
export default async function IntakeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const intake = await getIntake(id);
  if (!intake) notFound();

  return (
    <div className="space-y-6">
      <BackToIntakes />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-serif text-3xl tracking-tight">{intake.title}</h1>
        <StatusButtons id={intake.id} status={intake.status} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <SubmittedRequest intake={intake} />
        <div className="rounded-lg border border-line bg-card p-6 lg:col-span-2">
          <TriageAnalysis intake={intake} />
        </div>
      </div>
    </div>
  );
}

function SubmittedRequest({ intake }: { intake: SerializedIntake }) {
  return (
    <section className="h-fit rounded-lg border border-line bg-card p-6">
      <h2 className="font-mono text-xs tracking-widest text-faint uppercase">
        Submitted request
      </h2>

      <p className="mt-4 text-sm text-muted">Description</p>
      <p className="mt-1 leading-relaxed whitespace-pre-line">{intake.description}</p>

      <dl className="mt-6 space-y-3 border-t border-line pt-5 text-sm">
        <Row label="Industry" value={intake.industry} />
        <Row label="Budget" value={intake.budgetRange} />
        <Row label="Timeline" value={intake.timeline} />
        <Row label="Created" value={relativeTime(intake.createdAt)} />
      </dl>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function TriageAnalysis({ intake }: { intake: SerializedIntake }) {
  const { enrichment, tags, id } = intake;

  if (!enrichment) {
    return <p className="text-sm text-muted">No analysis has been queued for this intake.</p>;
  }

  // A run in flight is the stepper's, header and all: it has its own elapsed clock where the
  // finished states have a badge.
  if (enrichment.state === 'PENDING' || enrichment.state === 'PROCESSING') {
    return <LiveAnalysis intakeId={id} />;
  }

  // Retrying does not clear the previous result, so a retry that fails hard leaves one here.
  // It is still the best analysis this intake has, and burying it under a banner saying nothing
  // was generated would be both a worse page and a false one.
  const retained = enrichment.state === 'FAILED' && enrichment.summary !== null;

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <h2 className="font-mono text-xs tracking-widest text-faint uppercase">
          Triage analysis
        </h2>
        <StateBadge state={enrichment.state} />
      </div>

      <div className="mt-5 space-y-5">
        {enrichment.state === 'FAILED' && (
          <FailureBanner intakeId={id} enrichment={enrichment} retained={retained} />
        )}
        {enrichment.state === 'READY' && enrichment.source === 'FALLBACK' && (
          <FallbackBanner intakeId={id} enrichment={enrichment} />
        )}
        {(enrichment.state === 'READY' || retained) && (
          <>
            <Block label="Summary">
              <p className="leading-relaxed">{enrichment.summary}</p>
            </Block>
            <Block label="Tags">
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <TagChip key={tag} label={tag} />
                ))}
              </div>
            </Block>
            <Block label="Risk checklist">
              <RiskChecklist risks={enrichment.risks} />
            </Block>
          </>
        )}
      </div>

      <Instrumentation enrichment={enrichment} />
    </>
  );
}

function StateBadge({ state }: { state: Enrichment['state'] }) {
  const failed = state === 'FAILED';
  return (
    <span
      className={`rounded px-2 py-1 text-xs font-medium ${failed ? 'bg-clay text-clay-ink' : 'bg-sage text-sage-ink'}`}
    >
      {failed ? 'Failed' : 'Ready'}
    </span>
  );
}

// Ticking a box is a reading aid for whoever is triaging; nothing stores it, and nothing
// downstream reads it.
function RiskChecklist({ risks }: { risks: string[] }) {
  if (risks.length === 0) {
    return <p className="text-sm text-muted">The analysis flagged no risks.</p>;
  }

  return (
    <ul className="space-y-2">
      {risks.map((risk, index) => (
        // Keyed by position because applyGuardrails dedupes tags but not risks, so the same
        // sentence can legitimately appear twice.
        <li key={`${index}-${risk}`}>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 rounded-sm border border-line accent-ink"
            />
            <span>{risk}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

function FallbackBanner({ intakeId, enrichment }: { intakeId: string; enrichment: Enrichment }) {
  // A fallback can be written without the model ever having been called, and "did not respond
  // after 0 attempts" reads as a bug rather than as an explanation.
  const cause =
    enrichment.attempts > 0
      ? `The model did not respond after ${attemptCount(enrichment.attempts)}.`
      : 'The model did not produce a result.';

  return (
    <div className="rounded-md bg-amber px-4 py-3 text-amber-ink">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">AI unavailable — showing basic analysis</p>
          <p className="mt-1 text-sm">
            {cause} Tags and risks below were derived from the submitted fields.
          </p>
        </div>
        <RetryButton intakeId={intakeId} tone="fallback" />
      </div>
    </div>
  );
}

function FailureBanner({
  intakeId,
  enrichment,
  retained,
}: {
  intakeId: string;
  enrichment: Enrichment;
  retained: boolean;
}) {
  return (
    <div role="alert" className="rounded-md bg-clay px-4 py-3 text-clay-ink">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">Analysis failed</p>
          <p className="mt-1 text-sm">
            {retained
              ? 'What is below is the result from before the retry.'
              : 'The intake is saved and safe. Nothing was generated for it yet.'}
            {enrichment.attempts > 0 && ` Tried ${attemptCount(enrichment.attempts)}.`}
          </p>
        </div>
        <RetryButton intakeId={intakeId} tone="failed" />
      </div>
    </div>
  );
}

// Separate returns rather than a nested ternary, so adding a field doesn't mean working out
// which arm owns it.
function instrumentationParts(e: Enrichment): (string | null)[] {
  const attempts = e.attempts > 0 ? attemptCount(e.attempts) : null;

  if (e.state === 'FAILED') return ['state: FAILED', attempts, e.error];

  if (e.source === 'FALLBACK') {
    return ['source: fallback', attempts, e.error ? `last error: ${e.error}` : null];
  }

  return [
    e.model,
    e.promptVersion ? `prompt ${e.promptVersion}` : null,
    e.latencyMs !== null ? `${(e.latencyMs / 1000).toFixed(1)}s` : null,
    attempts,
  ];
}

function Instrumentation({ enrichment }: { enrichment: Enrichment }) {
  const line = instrumentationParts(enrichment).filter(Boolean).join(' · ');
  if (!line) return null;

  return (
    <p className="mt-6 border-t border-line pt-4 font-mono text-xs break-words text-faint">
      {line}
    </p>
  );
}
