import { describe, expect, it } from 'vitest';
import { backoffMs, loadWorkerConfig } from '../../lib/queue/config';

const base = {
  WORKER_CONCURRENCY: '4',
  WORKER_POLL_MS: '500',
  WORKER_LEASE_MS: '60000',
  WORKER_HEARTBEAT_MS: '15000',
  WORKER_MAX_ATTEMPTS: '3',
};

describe('loadWorkerConfig', () => {
  it('reads the documented defaults when nothing is set', () => {
    const config = loadWorkerConfig({});

    expect(config.concurrency).toBe(4);
    expect(config.leaseMs).toBe(60_000);
    expect(config.maxAttempts).toBe(3);
  });

  it('gives each worker process its own id', () => {
    expect(loadWorkerConfig({}).workerId).not.toBe(loadWorkerConfig({}).workerId);
  });

  it.each([
    ['not a number', { WORKER_CONCURRENCY: 'lots' }],
    ['zero', { WORKER_CONCURRENCY: '0' }],
    ['negative', { WORKER_POLL_MS: '-5' }],
    ['fractional', { WORKER_MAX_ATTEMPTS: '2.5' }],
  ])('refuses to start on a %s value', (_label, override) => {
    expect(() => loadWorkerConfig({ ...base, ...override })).toThrow(/invalid/i);
  });

  it('refuses a heartbeat longer than the lease, which would expire under a live worker', () => {
    expect(() =>
      loadWorkerConfig({ ...base, WORKER_HEARTBEAT_MS: '90000' }),
    ).toThrow(/shorter than/i);
  });
});

describe('backoffMs', () => {
  it('grows with each attempt', () => {
    expect(backoffMs(1)).toBeLessThan(backoffMs(4));
  });

  it('stays within the jitter window', () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const base = 2 ** attempt * 2_000;
      const value = backoffMs(attempt);
      expect(value).toBeGreaterThanOrEqual(base);
      expect(value).toBeLessThanOrEqual(base + 1_000);
    }
  });
});
