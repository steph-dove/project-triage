import type { PrismaClient } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadWorkerConfig } from '../../lib/queue/config';
import { Worker } from '../../lib/queue/worker';
import {
  RetriableError,
  type ClaimedJob,
  type FailureOutcome,
  type JobStore,
  type Processor,
  type Subscription,
} from '../../lib/queue/types';

const db = { event: { create: async () => ({}) } } as unknown as PrismaClient;

const config = (overrides: Record<string, string> = {}) =>
  loadWorkerConfig({
    WORKER_CONCURRENCY: '2',
    WORKER_POLL_MS: '10',
    WORKER_LEASE_MS: '1000',
    WORKER_HEARTBEAT_MS: '10',
    WORKER_MAX_ATTEMPTS: '3',
    WORKER_DRAIN_MS: '100',
    ...overrides,
  });

const job = (overrides: Partial<ClaimedJob> = {}): ClaimedJob => ({
  enrichmentId: 'e1',
  intakeId: 'i1',
  attempts: 1,
  lockToken: 't1',
  intake: {
    title: 'Test intake',
    description: 'A description long enough to be realistic.',
    budgetRange: '$50k-100k',
    timeline: '6 weeks',
    industry: 'Logistics',
  },
  ...overrides,
});

class FakeStore implements JobStore {
  readonly claims: number[] = [];
  readonly released: string[] = [];
  readonly failures: FailureOutcome[] = [];
  readonly completed: string[] = [];
  readonly announced: number[] = [];
  retired = false;
  heartbeatHeld = true;

  constructor(private readonly pending: ClaimedJob[] = []) {}

  async claim(limit: number) {
    this.claims.push(limit);
    return this.pending.splice(0, limit);
  }
  async heartbeat() {
    return this.heartbeatHeld;
  }
  async complete(enrichmentId: string) {
    this.completed.push(enrichmentId);
    return true;
  }
  async fail(_enrichmentId: string, _lockToken: string, outcome: FailureOutcome) {
    this.failures.push(outcome);
    return true;
  }
  async release(enrichmentId: string) {
    this.released.push(enrichmentId);
    return true;
  }
  async reap() {
    return 0;
  }
  async announce(concurrency: number) {
    this.announced.push(concurrency);
  }
  async retire() {
    this.retired = true;
  }
  subscribe(): Subscription {
    return { stop: () => {} };
  }
}

const blockUntilAborted: Processor = (_job, ctx) =>
  new Promise((_resolve, reject) => {
    ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });

const waitFor = async (predicate: () => boolean, timeout = 2_000) => {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the worker');
    await new Promise((r) => setTimeout(r, 5));
  }
};

let running: Worker | undefined;

const start = (store: FakeStore, processor: Processor, overrides?: Record<string, string>) => {
  running = new Worker(db, config(overrides), processor, store);
  running.start();
  return running;
};

afterEach(async () => {
  await running?.stop();
  running = undefined;
});

describe('shutdown', () => {
  it('hands an in-flight job back instead of failing it', async () => {
    const store = new FakeStore([job()]);
    const worker = start(store, blockUntilAborted);

    await waitFor(() => store.claims.length > 0);
    await worker.stop();

    expect(store.failures).toHaveLength(0);
    expect(store.released).toContain('e1');
  });
});

describe('presence', () => {
  it('announces on start, renews on the heartbeat, and retires on stop', async () => {
    const store = new FakeStore();
    const worker = start(store, blockUntilAborted);

    await waitFor(() => store.announced.length >= 2);
    expect(store.announced.every((c) => c === 2)).toBe(true);

    await worker.stop();
    expect(store.retired).toBe(true);
  });

  it('does not let a slow announce land after it has retired', async () => {
    const store = new FakeStore();
    const writes: string[] = [];
    store.announce = async () => {
      await new Promise((r) => setTimeout(r, 30));
      writes.push('announce');
    };
    store.retire = async () => {
      writes.push('retire');
    };

    const worker = start(store, blockUntilAborted, { WORKER_HEARTBEAT_MS: '500' });
    await worker.stop();
    // Long enough for an announce that was not waited for to land after the retire.
    await new Promise((r) => setTimeout(r, 60));

    expect(writes).toEqual(['announce', 'retire']);
  });

  it('keeps working when presence cannot be written, and still retires', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = new FakeStore([job()]);
    store.announce = async () => {
      throw new Error('database is locked');
    };
    const worker = start(store, async () => ({ summary: 's', tags: [], risks: [], source: 'LLM' }));

    await waitFor(() => store.completed.length > 0);
    await worker.stop();

    expect(errors).toHaveBeenCalledWith('[worker] could not record presence', expect.any(Error));
    expect(store.retired).toBe(true);
    errors.mockRestore();
  });

  it('never runs two presence writes at once', async () => {
    const store = new FakeStore();
    let inFlight = 0;
    let most = 0;
    store.announce = async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 40));
      inFlight -= 1;
    };

    // A 10ms heartbeat against a 40ms write piles several up.
    const worker = start(store, blockUntilAborted);
    await new Promise((r) => setTimeout(r, 120));
    await worker.stop();

    expect(most).toBe(1);
  });
});

describe('heartbeat', () => {
  it('aborts a job whose lease it no longer holds', async () => {
    const store = new FakeStore([job()]);
    store.heartbeatHeld = false;

    let aborted = false;
    const processor: Processor = (_job, ctx) =>
      new Promise((_resolve, reject) => {
        ctx.signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            reject(new Error('aborted'));
          },
          { once: true },
        );
      });

    start(store, processor);

    await waitFor(() => aborted);
  });
});

describe('failures', () => {
  it('schedules a retry for a RetriableError', async () => {
    const store = new FakeStore([job()]);
    start(store, async () => {
      throw new RetriableError('upstream is down');
    });

    await waitFor(() => store.failures.length > 0);

    expect(store.failures[0].error).toBe('upstream is down');
    expect(store.failures[0].retryAt).toBeInstanceOf(Date);
  });

  it('gives up on anything else', async () => {
    const store = new FakeStore([job()]);
    start(store, async () => {
      throw new Error('the model returned nonsense');
    });

    await waitFor(() => store.failures.length > 0);

    expect(store.failures[0].retryAt).toBeUndefined();
  });

  it('stops retrying once the attempts are spent', async () => {
    const store = new FakeStore([job({ attempts: 3 })]);
    start(store, async () => {
      throw new RetriableError('upstream is still down');
    });

    await waitFor(() => store.failures.length > 0);

    expect(store.failures[0].retryAt).toBeUndefined();
  });
});

describe('capacity', () => {
  it('never asks for more jobs than it has room for', async () => {
    const store = new FakeStore([job()]);
    start(store, blockUntilAborted);

    await waitFor(() => store.claims.length >= 2);

    expect(store.claims[0]).toBe(2);
    expect(store.claims[1]).toBe(1);
  });
});
