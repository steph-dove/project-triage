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
  // One transaction so every number comes from the same snapshot. Separate reads let an intake
  // created mid-render push the status bars past the total.
  const [total, byStatus, byState, fallbacks, tags, workers, latencies, recentRetries] =
    await db.$transaction((tx) =>
      Promise.all([
        tx.intake.count(),
        tx.intake.groupBy({ by: ['status'], _count: true }),
        tx.enrichment.groupBy({ by: ['state'], _count: true }),
        tx.enrichment.count({ where: { state: 'READY', source: 'FALLBACK' } }),
        tx.tag.groupBy({
          by: ['label'],
          _count: { label: true },
          // Label second so a tie does not reshuffle between refreshes.
          orderBy: [{ _count: { label: 'desc' } }, { label: 'asc' }],
          take: TOP_TAGS,
        }),
        liveWorkers(tx, now),
        tx.enrichment.findMany({
          where: { state: 'READY', source: 'LLM', latencyMs: { not: null } },
          orderBy: { updatedAt: 'desc' },
          take: LATENCY_SAMPLE,
          select: { latencyMs: true },
        }),
        tx.event.count({
          where: {
            type: 'RETRY_SCHEDULED',
            createdAt: { gt: new Date(now.getTime() - RETRY_WINDOW_MS) },
          },
        }),
      ]),
    );

  const statusCounts = Object.fromEntries(TRIAGE_STATUSES.map((s) => [s, 0])) as Record<
    TriageStatus,
    number
  >;
  for (const row of byStatus) {
    if (row.status in statusCounts) statusCounts[row.status as TriageStatus] = row._count;
  }

  const stateCount = (state: EnrichmentState) =>
    byState.find((row) => row.state === state)?._count ?? 0;
  const ready = stateCount('READY');
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
