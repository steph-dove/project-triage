import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { emit, type EventType } from '../events';
import type {
  ClaimedJob,
  EnrichmentResult,
  FailureOutcome,
  JobStore,
  QueueEvent,
  SubscribeHandlers,
  Subscription,
} from './types';

class StaleLockError extends Error {}

const TAIL_INTERVAL_MS = 250;
const MAX_TAIL_BACKOFF = 5;

export type TailOptions = {
  sinceSeq: number;
  // The SSE route serves one detail page at a time; the worker wants everything.
  intakeId?: string;
  // Narrows at the query, so frames the caller would discard are never built or sent.
  types?: readonly EventType[];
};

// Outside the store because the stream endpoint needs the same tail, and handing it a job store
// built with a made-up worker id would misrepresent what the object is.
export function tailEvents(
  db: PrismaClient,
  { sinceSeq, intakeId, types }: TailOptions,
  { onEvent, onError }: SubscribeHandlers,
): Subscription {
  let cursor = sinceSeq;
  let stopped = false;
  let consecutiveFailures = 0;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    if (stopped) return;

    try {
      const rows = await db.event.findMany({
        where: {
          seq: { gt: cursor },
          ...(intakeId ? { intakeId } : {}),
          ...(types ? { type: { in: [...types] } } : {}),
        },
        orderBy: { seq: 'asc' },
        take: 200,
      });
      consecutiveFailures = 0;

      for (const row of rows) {
        if (stopped) return;
        cursor = row.seq;
        onEvent(row as QueueEvent);
      }
    } catch (err) {
      consecutiveFailures += 1;
      console.error(`[queue] event tail failed ${consecutiveFailures}x`, err);
      onError?.(err, consecutiveFailures);
    }

    if (!stopped) {
      const delay = TAIL_INTERVAL_MS * 2 ** Math.min(consecutiveFailures, MAX_TAIL_BACKOFF);
      timer = setTimeout(tick, delay);
    }
  };

  void tick();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

// Exported so the retry endpoint clears the same fields: "this row holds no lease" is one
// fact, and a lock field added later has to reach both places.
export const releasedLock = {
  lockedBy: null,
  lockToken: null,
  leaseExpiresAt: null,
} as const;

/**
 * Puts a finished enrichment back on the queue and announces it on the stream.
 *
 * Lives here rather than in the route handler because the enrichment row is the job record:
 * which columns say "claimable" is the queue's business, and the Postgres adapter would have
 * to change it in step. Returns false when the row is already PENDING or PROCESSING, which is
 * how an impatient double-click gets turned away.
 */
export async function requeueIntake(db: PrismaClient, intakeId: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    // Compare-and-swap rather than a read then a write: two clicks arriving together would
    // both pass a separate check and queue the same work twice.
    const { count } = await tx.enrichment.updateMany({
      where: { intakeId, state: { in: ['READY', 'FAILED'] } },
      // summary, risks and tags are deliberately untouched. A retry that ends in a hard failure
      // would otherwise destroy a usable fallback result, and the detail page still shows it.
      data: {
        state: 'PENDING',
        attempts: 0,
        error: null,
        nextAttemptAt: new Date(),
        ...releasedLock,
      },
    });
    if (count === 0) return false;

    await emit(tx, intakeId, 'QUEUED', { retry: true });
    return true;
  });
}

// Beside announce() because the two halves of "online" have to agree: announce sets expiresAt a
// lease ahead, and this counts whoever has not run out yet.
export function liveWorkers(db: PrismaClient, now = new Date()) {
  return db.worker.findMany({ where: { expiresAt: { gt: now } }, select: { concurrency: true } });
}

export class SqliteJobStore implements JobStore {
  constructor(
    private readonly db: PrismaClient,
    private readonly workerId: string,
    private readonly leaseMs: number,
  ) {}

  async claim(limit: number): Promise<ClaimedJob[]> {
    if (limit <= 0) return [];

    const candidates = await this.db.enrichment.findMany({
      where: { state: 'PENDING', nextAttemptAt: { lte: new Date() } },
      orderBy: { nextAttemptAt: 'asc' },
      // Over-fetch: some of these will be taken by another replica before we get to them.
      take: limit * 3,
      select: { id: true },
    });

    const claimed: ClaimedJob[] = [];

    for (const candidate of candidates) {
      if (claimed.length >= limit) break;

      const lockToken = randomUUID();
      // Compare-and-swap: two workers racing the same row cannot both get count 1.
      const result = await this.db.enrichment.updateMany({
        where: { id: candidate.id, state: 'PENDING' },
        data: {
          state: 'PROCESSING',
          lockedBy: this.workerId,
          lockToken,
          leaseExpiresAt: new Date(Date.now() + this.leaseMs),
          attempts: { increment: 1 },
        },
      });
      if (result.count === 0) continue;

      const row = await this.db.enrichment.findUniqueOrThrow({
        where: { id: candidate.id },
        select: {
          id: true,
          intakeId: true,
          attempts: true,
          intake: {
            select: {
              title: true,
              description: true,
              budgetRange: true,
              timeline: true,
              industry: true,
            },
          },
        },
      });

      claimed.push({
        enrichmentId: row.id,
        intakeId: row.intakeId,
        attempts: row.attempts,
        lockToken,
        intake: row.intake,
      });
    }

    return claimed;
  }

  async heartbeat(enrichmentId: string, lockToken: string): Promise<boolean> {
    const result = await this.db.enrichment.updateMany({
      where: { id: enrichmentId, lockToken, state: 'PROCESSING' },
      data: { leaseExpiresAt: new Date(Date.now() + this.leaseMs) },
    });
    return result.count === 1;
  }

  async complete(
    enrichmentId: string,
    lockToken: string,
    result: EnrichmentResult,
  ): Promise<boolean> {
    return this.fenced(enrichmentId, lockToken, async (tx, intakeId) => {
      await tx.enrichment.updateMany({
        where: { id: enrichmentId, lockToken },
        data: {
          state: 'READY',
          summary: result.summary,
          risks: JSON.stringify(result.risks),
          source: result.source,
          model: result.model ?? null,
          promptVersion: result.promptVersion ?? null,
          rawResponse: result.rawResponse ?? null,
          latencyMs: result.latencyMs ?? null,
          tokensIn: result.tokensIn ?? null,
          tokensOut: result.tokensOut ?? null,
          error: null,
          ...releasedLock,
        },
      });

      // Replaced, not merged, so a retry does not leave tags from the attempt before it.
      await tx.tag.deleteMany({ where: { intakeId } });
      if (result.tags.length > 0) {
        await tx.tag.createMany({
          data: result.tags.map((label) => ({ intakeId, label })),
        });
      }

      await emit(tx, intakeId, result.source === 'FALLBACK' ? 'FALLBACK' : 'READY', {
        source: result.source,
      });
    });
  }

  async fail(
    enrichmentId: string,
    lockToken: string,
    outcome: FailureOutcome,
  ): Promise<boolean> {
    return this.fenced(enrichmentId, lockToken, async (tx, intakeId) => {
      const retrying = outcome.retryAt !== undefined;

      await tx.enrichment.updateMany({
        where: { id: enrichmentId, lockToken },
        data: {
          state: retrying ? 'PENDING' : 'FAILED',
          error: outcome.error,
          // Backoff lives in the database, so it survives a restart.
          ...(outcome.retryAt ? { nextAttemptAt: outcome.retryAt } : {}),
          ...releasedLock,
        },
      });

      await emit(
        tx,
        intakeId,
        retrying ? 'RETRY_SCHEDULED' : 'FAILED',
        retrying ? { error: outcome.error, retryAt: outcome.retryAt } : { error: outcome.error },
      );
    });
  }

  // claim() counts the attempt up front, so the hand-back gives it back: otherwise rolling
  // restarts alone would exhaust maxAttempts on a job that never ran.
  async release(enrichmentId: string, lockToken: string): Promise<boolean> {
    const result = await this.db.enrichment.updateMany({
      where: { id: enrichmentId, lockToken },
      data: {
        state: 'PENDING',
        nextAttemptAt: new Date(),
        attempts: { decrement: 1 },
        ...releasedLock,
      },
    });
    return result.count === 1;
  }

  async announce(concurrency: number): Promise<void> {
    const now = Date.now();
    const expiresAt = new Date(now + this.leaseMs);

    await this.db.$transaction([
      // A live worker renews well inside its lease, so anything past it crashed without retiring.
      this.db.worker.deleteMany({ where: { expiresAt: { lt: new Date(now) } } }),
      this.db.worker.upsert({
        where: { id: this.workerId },
        create: { id: this.workerId, concurrency, expiresAt },
        update: { concurrency, expiresAt },
      }),
    ]);
  }

  async retire(): Promise<void> {
    await this.db.worker.deleteMany({ where: { id: this.workerId } });
  }

  // No coordinator: a dead worker stops extending its lease, whoever notices first resets it.
  async reap(): Promise<number> {
    const result = await this.db.enrichment.updateMany({
      where: { state: 'PROCESSING', leaseExpiresAt: { lt: new Date() } },
      data: { state: 'PENDING', nextAttemptAt: new Date(), ...releasedLock },
    });
    return result.count;
  }

  // The Postgres adapter swaps LISTEN/NOTIFY in behind this same signature.
  subscribe(sinceSeq: number, handlers: SubscribeHandlers): Subscription {
    return tailEvents(this.db, { sinceSeq }, handlers);
  }

  // Token checked inside the transaction, so a reaped worker's late write rolls back whole.
  private async fenced(
    enrichmentId: string,
    lockToken: string,
    work: (
      tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
      intakeId: string,
    ) => Promise<void>,
  ): Promise<boolean> {
    try {
      await this.db.$transaction(async (tx) => {
        const row = await tx.enrichment.findFirst({
          where: { id: enrichmentId, lockToken },
          select: { intakeId: true },
        });
        if (!row) throw new StaleLockError();

        await work(tx, row.intakeId);
      });
      return true;
    } catch (err) {
      if (err instanceof StaleLockError) return false;
      throw err;
    }
  }
}
