import { db } from './db';
import { liveWorkers } from './queue/sqlite-store';
import { TRIAGE_STATUSES, type EnrichmentState, type TriageStatus } from './schemas';

const TOP_TAGS = 5;

// Enough for a stable median without scanning every result the app has ever produced.
const LATENCY_SAMPLE = 500;

// A rolling window rather than "since midnight": the server's midnight is UTC in a container,
// which is nobody's working day.
const RETRY_WINDOW_MS = 24 * 60 * 60_000;

export type Dashboard = Awaited<ReturnType<typeof getDashboard>>;

export async function getDashboard(now: Date = new Date()) {
  // Not a transaction: Prisma opens one on SQLite with BEGIN IMMEDIATE, which would hold the
  // write lock for the whole render and stall the workers. Total comes from the status groupBy
  // instead, so the bars and the headline still add up.
  const [byStatus, bySource, tags, workers, latencies, recentRetries] =
    await Promise.all([
      db.intake.groupBy({ by: ['status'], _count: true }),
      // State and source in one read, so the fallback share cannot be worked out from two
      // counts taken either side of a result landing and read over 100%.
      db.enrichment.groupBy({ by: ['state', 'source'], _count: true }),
      db.tag.groupBy({
        by: ['label'],
        _count: { label: true },
        // Label second so a tie does not reshuffle between refreshes.
        orderBy: [{ _count: { label: 'desc' } }, { label: 'asc' }],
        take: TOP_TAGS,
      }),
      liveWorkers(db, now),
      db.enrichment.findMany({
        where: { state: 'READY', source: 'LLM', latencyMs: { not: null } },
        orderBy: { updatedAt: 'desc' },
        take: LATENCY_SAMPLE,
        select: { latencyMs: true },
      }),
      db.event.count({
        where: {
          type: 'RETRY_SCHEDULED',
          createdAt: { gt: new Date(now.getTime() - RETRY_WINDOW_MS) },
        },
      }),
    ]);

  const statusCounts = Object.fromEntries(TRIAGE_STATUSES.map((s) => [s, 0])) as Record<
    TriageStatus,
    number
  >;
  for (const row of byStatus) {
    if (row.status in statusCounts) statusCounts[row.status as TriageStatus] = row._count;
  }

  const total = byStatus.reduce((sum, row) => sum + row._count, 0);

  const stateCount = (state: EnrichmentState, source?: string) =>
    bySource
      .filter((row) => row.state === state && (source === undefined || row.source === source))
      .reduce((sum, row) => sum + row._count, 0);
  const ready = stateCount('READY');
  const fallbacks = stateCount('READY', 'FALLBACK');
  const concurrencies = workers.map((w) => w.concurrency);

  return {
    total,
    awaiting: stateCount('PENDING') + stateCount('PROCESSING'),
    failed: stateCount('FAILED'),
    // Undefined rather than 0% when nothing has finished, which would read as a clean record.
    fallbackShare: ready > 0 ? fallbacks / ready : undefined,
    byStatus: TRIAGE_STATUSES.map((status) => ({ status, count: statusCounts[status] })),
    topTags: tags.map((row) => ({ label: row.label, count: row._count.label })),
    queue: {
      workersOnline: workers.length,
      concurrency:
        concurrencies.length > 0
          ? { min: Math.min(...concurrencies), max: Math.max(...concurrencies) }
          : undefined,
      inFlight: stateCount('PROCESSING'),
      medianLatencyMs: median(latencies.map((row) => row.latencyMs!)),
      recentRetries,
    },
  };
}

export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const NONE = '—';

export function formatShare(share: number | undefined): string {
  return share === undefined ? NONE : `${Math.round(share * 100)}%`;
}

export function formatRange(range: { min: number; max: number } | undefined): string {
  if (!range) return NONE;
  return range.min === range.max ? String(range.min) : `${range.min}–${range.max}`;
}

export function formatLatency(ms: number | undefined): string {
  return ms === undefined ? NONE : `${(ms / 1000).toFixed(1)}s`;
}

// Clamped because the counts behind a bar are separate reads, and a bar past its track spills
// out of the card.
export function barPercent(count: number, of: number): number {
  return of > 0 ? Math.min(100, (count / of) * 100) : 0;
}
