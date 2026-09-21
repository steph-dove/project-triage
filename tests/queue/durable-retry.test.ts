import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAiConfig } from '../../lib/ai/config';
import type { TriageProvider } from '../../lib/ai/types';
import { loadWorkerConfig } from '../../lib/queue/config';
import { createEnrichmentProcessor } from '../../lib/queue/processors/enrich';
import { RetriableError } from '../../lib/queue/types';
import { Worker } from '../../lib/queue/worker';

// Everything below the provider is real: the worker loop, the SQLite store and the enrichment
// processor, so a retry has to survive a round trip through the database to count.
const provider = vi.hoisted(() => ({ current: undefined as TriageProvider | undefined }));
vi.mock('../../lib/ai/provider', () => ({
  createProvider: (): TriageProvider => (intake, ctx) => provider.current!(intake, ctx),
}));

const MAX_ATTEMPTS = 3;

const db = new PrismaClient();

const answer: TriageProvider = async () => ({
  output: {
    summary: 'A regional carrier wants demand forecasting across twenty depots.',
    tags: ['Forecasting', 'logistics', 'ML ops'],
    risks: ['One analyst owns the current model'],
  },
  raw: '{}',
  model: 'test-model',
  latencyMs: 12,
  tokensIn: 100,
  tokensOut: 40,
});

// Fails the first `failures` calls, then answers.
const flaky = (failures: number) => {
  let calls = 0;
  const run: TriageProvider = async (intake, ctx) => {
    calls += 1;
    if (calls <= failures) throw new RetriableError(`upstream 503 on call ${calls}`);
    return answer(intake, ctx);
  };
  return { run, calls: () => calls };
};

async function seedIntake(title = 'Forecasting for a regional carrier') {
  const intake = await db.intake.create({
    data: {
      title,
      description: 'We want to forecast freight demand across twenty depots, from a spreadsheet.',
      budgetRange: '$50k-100k',
      timeline: '6 weeks',
      industry: 'Logistics',
      enrichment: { create: {} },
    },
    select: { id: true },
  });
  return intake.id;
}

const enrichmentFor = (intakeId: string) =>
  db.enrichment.findUniqueOrThrow({ where: { intakeId } });

const eventTypes = async (intakeId: string) =>
  (await db.event.findMany({ where: { intakeId }, orderBy: { seq: 'asc' } })).map((e) => e.type);

const waitFor = async (predicate: () => Promise<boolean>, timeout = 3_000) => {
  const deadline = performance.now() + timeout;
  while (!(await predicate())) {
    if (performance.now() > deadline) throw new Error('timed out waiting on the queue');
    await new Promise((r) => setTimeout(r, 10));
  }
};

// Waits for either outcome, so ending up in the wrong one fails on the assertion that says so
// rather than on a timeout.
async function settled(intakeId: string) {
  await waitFor(async () => ['READY', 'FAILED'].includes((await enrichmentFor(intakeId)).state));
  return enrichmentFor(intakeId);
}

// Steps the clock past the persisted nextAttemptAt instead of sitting through the real backoff,
// and returns how long that wait would have been.
async function skipBackoff(intakeId: string, attempts: number) {
  await waitFor(async () => {
    const row = await enrichmentFor(intakeId);
    return row.state === 'PENDING' && row.attempts === attempts;
  });

  const { nextAttemptAt } = await enrichmentFor(intakeId);
  const wait = nextAttemptAt.getTime() - Date.now();
  vi.setSystemTime(nextAttemptAt.getTime() + 1);
  return wait;
}

let worker: Worker | undefined;

function startWorker({ concurrency = 2 } = {}) {
  const config = loadWorkerConfig({
    WORKER_CONCURRENCY: String(concurrency),
    WORKER_POLL_MS: '10',
    WORKER_LEASE_MS: '5000',
    WORKER_HEARTBEAT_MS: '1000',
    WORKER_MAX_ATTEMPTS: String(MAX_ATTEMPTS),
    WORKER_DRAIN_MS: '100',
  });
  const processor = createEnrichmentProcessor(loadAiConfig({ AI_PROVIDER: 'mock' }), MAX_ATTEMPTS);
  worker = new Worker(db, config, processor);
  worker.start();
}

beforeEach(async () => {
  // Only Date: the worker's poll loop still needs real timers to make progress.
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  await db.intake.deleteMany();
});

afterEach(async () => {
  await worker?.stop();
  worker = undefined;
  provider.current = undefined;
  vi.useRealTimers();
});

afterAll(async () => {
  await db.$disconnect();
});

describe('a retriable failure', () => {
  it('goes back through the database and succeeds on the third attempt', async () => {
    const upstream = flaky(2);
    provider.current = upstream.run;
    const id = await seedIntake();

    startWorker();
    const firstWait = await skipBackoff(id, 1);
    const secondWait = await skipBackoff(id, 2);
    const row = await settled(id);

    // backoffMs is 2^attempt * 2s plus under 1s of jitter, so 4-5s and then 8-9s.
    expect(firstWait).toBeGreaterThan(3_000);
    expect(secondWait).toBeGreaterThan(firstWait);

    expect(upstream.calls()).toBe(3);
    expect(row).toMatchObject({
      state: 'READY',
      source: 'LLM',
      attempts: 3,
      error: null,
      lockToken: null,
    });
    expect(await db.tag.findMany({ where: { intakeId: id }, select: { label: true } })).toEqual([
      { label: 'forecasting' },
      { label: 'logistics' },
      { label: 'ml-ops' },
    ]);

    const types = await eventTypes(id);
    expect(types.filter((t) => t === 'RETRY_SCHEDULED')).toHaveLength(2);
    expect(types.filter((t) => t === 'CLAIMED')).toHaveLength(3);
    expect(types.at(-1)).toBe('READY');
  });
});

describe('running out of attempts', () => {
  it('saves the heuristic fallback rather than failing the intake', async () => {
    const upstream = flaky(Infinity);
    provider.current = upstream.run;
    const id = await seedIntake();

    startWorker();
    await skipBackoff(id, 1);
    await skipBackoff(id, 2);
    const row = await settled(id);

    expect(upstream.calls()).toBe(MAX_ATTEMPTS);
    expect(row).toMatchObject({
      state: 'READY',
      source: 'FALLBACK',
      attempts: MAX_ATTEMPTS,
      lockToken: null,
    });
    expect(row.summary).toBeTruthy();
    expect(JSON.parse(row.rawResponse!).fallbackReason).toMatch(/upstream 503 on call 3/);
    expect(await db.tag.count({ where: { intakeId: id } })).toBe(3);

    const types = await eventTypes(id);
    expect(types.at(-1)).toBe('FALLBACK');
    expect(types).not.toContain('FAILED');
  });

  it('keeps the worker running after a job blows up, and takes the next one', async () => {
    const first = await seedIntake('The one that breaks');
    const second = await seedIntake('The one after it');
    provider.current = async (intake, ctx) => {
      if (intake.title === 'The one that breaks') throw new TypeError('cannot read "choices"');
      return answer(intake, ctx);
    };

    // One slot, so the second job is only claimed after the first has blown up.
    startWorker({ concurrency: 1 });
    const failed = await settled(first);
    const next = await settled(second);

    // Not retriable and not an intake the model refused, so no fallback: this one is a bug.
    expect(failed).toMatchObject({
      state: 'FAILED',
      error: 'cannot read "choices"',
      attempts: 1,
      source: null,
    });
    expect(next.state).toBe('READY');
  });
});
