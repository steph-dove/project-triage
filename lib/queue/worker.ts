import type { PrismaClient } from '@prisma/client';
import { emit } from '../events';
import { backoffMs, type WorkerConfig } from './config';
import { SqliteJobStore } from './sqlite-store';
import { RetriableError, type ClaimedJob, type JobStore, type Processor } from './types';

type InFlight = { job: ClaimedJob; controller: AbortController };

export class Worker {
  private readonly inFlight = new Map<string, InFlight>();
  private running = false;
  private pollTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  // Awaited before retiring, or an upsert still in flight would put the row straight back.
  private presence: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: PrismaClient,
    private readonly config: WorkerConfig,
    private readonly processor: Processor,
    private readonly store: JobStore = new SqliteJobStore(db, config.workerId, config.leaseMs),
  ) {}

  start() {
    if (this.running) return;
    this.running = true;

    console.log(
      `[worker ${this.config.workerId}] up, concurrency ${this.config.concurrency}, lease ${this.config.leaseMs}ms`,
    );

    this.heartbeatTimer = setInterval(() => void this.beat(), this.config.heartbeatMs);
    this.announce();
    void this.tick();
  }

  async stop() {
    if (!this.running) return;
    this.running = false;

    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    console.log(`[worker ${this.config.workerId}] draining ${this.inFlight.size} job(s)`);

    // Has to land inside the scheduler's SIGTERM grace, or we get SIGKILLed mid-drain and
    // release nothing.
    const drained = await Promise.race([
      this.settle(),
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), this.config.drainMs)),
    ]);

    for (const { job, controller } of this.inFlight.values()) {
      controller.abort();
      await this.store.release(job.enrichmentId, job.lockToken).catch((err) => {
        console.error(`[worker] could not release ${job.enrichmentId} on shutdown`, err);
      });
    }

    await this.presence;
    await this.store.retire().catch((err) => {
      console.error('[worker] could not retire, the dashboard will count it until it expires', err);
    });

    if (drained === 'timeout') console.warn('[worker] drain timed out, released the stragglers');
    console.log(`[worker ${this.config.workerId}] stopped`);
  }

  // inFlight is keyed by enrichmentId, so a late-settling run must not evict a newer claim
  // of the same row.
  private forget(job: ClaimedJob) {
    if (this.inFlight.get(job.enrichmentId)?.job.lockToken === job.lockToken) {
      this.inFlight.delete(job.enrichmentId);
    }
  }

  private async settle() {
    while (this.inFlight.size > 0) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return 'drained' as const;
  }

  private async tick() {
    if (!this.running) return;

    try {
      const reaped = await this.store.reap();
      if (reaped > 0) console.log(`[worker] reaped ${reaped} expired lease(s)`);

      const capacity = this.config.concurrency - this.inFlight.size;
      const jobs = await this.store.claim(capacity);

      for (const job of jobs) void this.run(job);
    } catch (err) {
      console.error('[worker] tick failed, continuing', err);
    }

    if (this.running) this.pollTimer = setTimeout(() => void this.tick(), this.config.pollMs);
  }

  private announce() {
    if (!this.running) return;
    this.presence = this.store.announce(this.config.concurrency).catch((err) => {
      console.error('[worker] could not record presence', err);
    });
  }

  private async beat() {
    this.announce();

    for (const { job, controller } of this.inFlight.values()) {
      try {
        const held = await this.store.heartbeat(job.enrichmentId, job.lockToken);
        if (!held) {
          // Reaped mid-job: stop now rather than finish and be rejected by the fencing token.
          console.warn(`[worker] lost the lease on ${job.enrichmentId}, abandoning it`);
          controller.abort();
          this.forget(job);
        }
      } catch (err) {
        console.error(`[worker] heartbeat failed for ${job.enrichmentId}`, err);
      }
    }
  }

  private async run(job: ClaimedJob) {
    const controller = new AbortController();
    this.inFlight.set(job.enrichmentId, { job, controller });

    const emitFor = async (type: Parameters<typeof emit>[2], payload?: unknown) => {
      await emit(this.db, job.intakeId, type, payload);
    };

    try {
      await emitFor('CLAIMED', { workerId: this.config.workerId, attempt: job.attempts });

      const result = await this.processor(job, { emit: emitFor, signal: controller.signal });

      const written = await this.store.complete(job.enrichmentId, job.lockToken, result);
      if (!written) {
        console.warn(`[worker] discarded a stale result for ${job.enrichmentId}`);
      }
    } catch (err) {
      // stop() clears running before it aborts anything, so this tells a shutdown abort apart
      // from a real failure.
      if (this.running) {
        await this.onFailure(job, err);
      } else {
        await this.store.release(job.enrichmentId, job.lockToken).catch((releaseErr) => {
          console.error(`[worker] could not release ${job.enrichmentId} on shutdown`, releaseErr);
        });
      }
    } finally {
      this.forget(job);
    }
  }

  private async onFailure(job: ClaimedJob, err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const exhausted = job.attempts >= this.config.maxAttempts;
    const retriable = err instanceof RetriableError && !exhausted;

    console.error(
      `[worker] ${job.enrichmentId} attempt ${job.attempts}/${this.config.maxAttempts} failed${retriable ? ', retrying' : ''}: ${message}`,
    );

    try {
      await this.store.fail(job.enrichmentId, job.lockToken, {
        error: message,
        retryAt: retriable ? new Date(Date.now() + backoffMs(job.attempts)) : undefined,
      });
    } catch (writeErr) {
      // The lease expires and another worker retries, so nothing is lost, but this usually
      // means the database is unreachable.
      console.error(`[worker] could not record the failure for ${job.enrichmentId}`, writeErr);
    }
  }
}
