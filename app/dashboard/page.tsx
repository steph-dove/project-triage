import type { Metadata } from 'next';
import { getDashboard, type Dashboard } from '@/lib/dashboard';
import { STATUS_LABELS } from '@/lib/status';

export const metadata: Metadata = { title: 'Dashboard · Intake Triage' };

// Rendered per request: the worker writes behind Next's back, so a cached render is stale.
export const dynamic = 'force-dynamic';

const NONE = '—';

export default async function DashboardPage() {
  const data = await getDashboard();

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total intakes" value={data.total} />
        <Stat label="Awaiting analysis" value={data.awaiting} highlight={data.awaiting > 0} />
        <Stat
          label="Served by fallback"
          value={data.fallbackShare === undefined ? NONE : `${Math.round(data.fallbackShare * 100)}%`}
        />
        <Stat label="Failed" value={data.failed} />
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-[1fr_1.2fr_1fr]">
        <Panel title="By status">
          <ul className="space-y-5">
            {data.byStatus.map(({ status, count }) => (
              <Bar
                key={status}
                label={STATUS_LABELS[status]}
                count={count}
                // Share of all intakes, so the four bars add up to the whole.
                of={data.total}
                barClass="bg-ink"
              />
            ))}
          </ul>
        </Panel>

        <Panel title="Top tags">
          {data.topTags.length === 0 ? (
            <p className="text-sm text-muted">No tags yet. They appear once an analysis finishes.</p>
          ) : (
            <ul className="space-y-5">
              {data.topTags.map(({ label, count }) => (
                <Bar
                  key={label}
                  label={label}
                  count={count}
                  // Relative to the leader: a share of all tags would leave every bar a sliver.
                  of={data.topTags[0].count}
                  barClass="bg-rust"
                  mono
                />
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Queue health">
          <QueueHealth queue={data.queue} />
        </Panel>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number | string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-card px-5 py-5">
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-2 font-serif text-4xl ${highlight ? 'text-rust' : 'text-ink'}`}>{value}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-card px-6 py-6 lg:min-h-[36rem]">
      <h2 className="mb-6 font-mono text-xs font-semibold tracking-widest text-muted uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Bar({
  label,
  count,
  of,
  barClass,
  mono = false,
}: {
  label: string;
  count: number;
  of: number;
  barClass: string;
  mono?: boolean;
}) {
  const percent = of > 0 ? (count / of) * 100 : 0;

  return (
    <li>
      <div className="mb-2 flex items-baseline justify-between gap-4 text-sm">
        <span className={mono ? 'truncate font-mono' : ''}>{label}</span>
        <span className="text-muted">{count}</span>
      </div>
      <div className="h-2 rounded-full bg-line" aria-hidden>
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${percent}%` }} />
      </div>
    </li>
  );
}

function QueueHealth({ queue }: { queue: Dashboard['queue'] }) {
  const { concurrency, medianLatencyMs } = queue;

  const rows: [string, string | number][] = [
    ['Workers online', queue.workersOnline],
    [
      'Concurrency each',
      !concurrency
        ? NONE
        : concurrency.min === concurrency.max
          ? concurrency.min
          : `${concurrency.min}–${concurrency.max}`,
    ],
    ['In flight', queue.inFlight],
    ['Median latency', medianLatencyMs === undefined ? NONE : `${(medianLatencyMs / 1000).toFixed(1)}s`],
    ['Retries, last 24h', queue.recentRetries],
  ];

  return (
    <dl className="space-y-3 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4">
          <dt className="text-muted">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
