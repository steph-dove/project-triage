import { hostname } from 'node:os';
import { z } from 'zod';

const positiveInt = (name: string) =>
  z.coerce
    .number({ invalid_type_error: `${name} must be a number.` })
    .int(`${name} must be a whole number.`)
    .positive(`${name} must be greater than zero.`);

const WorkerConfigSchema = z
  .object({
    WORKER_CONCURRENCY: positiveInt('WORKER_CONCURRENCY').default(4),
    WORKER_POLL_MS: positiveInt('WORKER_POLL_MS').default(500),
    WORKER_LEASE_MS: positiveInt('WORKER_LEASE_MS').default(60_000),
    WORKER_HEARTBEAT_MS: positiveInt('WORKER_HEARTBEAT_MS').default(15_000),
    WORKER_MAX_ATTEMPTS: positiveInt('WORKER_MAX_ATTEMPTS').default(3),
  })
  .refine((c) => c.WORKER_HEARTBEAT_MS < c.WORKER_LEASE_MS, {
    message:
      'WORKER_HEARTBEAT_MS must be shorter than WORKER_LEASE_MS, or leases expire under a worker that is still running.',
  });

export type WorkerConfig = {
  workerId: string;
  concurrency: number;
  pollMs: number;
  leaseMs: number;
  heartbeatMs: number;
  maxAttempts: number;
};

// Throws rather than defaulting: a misconfigured worker is invisible until it matters.
export function loadWorkerConfig(
  env: Record<string, string | undefined> = process.env,
): WorkerConfig {
  const parsed = WorkerConfigSchema.safeParse(env);

  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.message}`).join('\n');
    throw new Error(`Worker configuration is invalid:\n${problems}`);
  }

  const c = parsed.data;

  return {
    workerId: `${hostname()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
    concurrency: c.WORKER_CONCURRENCY,
    pollMs: c.WORKER_POLL_MS,
    leaseMs: c.WORKER_LEASE_MS,
    heartbeatMs: c.WORKER_HEARTBEAT_MS,
    maxAttempts: c.WORKER_MAX_ATTEMPTS,
  };
}

// Jittered so replicas that failed on the same upstream blip do not all return at once.
export function backoffMs(attempts: number): number {
  const base = 2 ** attempts * 2_000;
  return Math.round(base + Math.random() * 1_000);
}
