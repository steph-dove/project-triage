import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SqliteJobStore } from '../../lib/queue/sqlite-store';
import type { EnrichmentResult } from '../../lib/queue/types';

const db = new PrismaClient();

const result = (summary: string, tags: string[] = ['a', 'b', 'c']): EnrichmentResult => ({
  summary,
  tags,
  risks: ['something to watch'],
  source: 'LLM',
});

async function seedIntake(overrides: { nextAttemptAt?: Date } = {}) {
  const intake = await db.intake.create({
    data: {
      title: 'Test intake',
      description: 'A description long enough to be realistic for the triage summary.',
      budgetRange: '$50k-100k',
      timeline: '6 weeks',
      industry: 'Logistics',
      enrichment: { create: { nextAttemptAt: overrides.nextAttemptAt ?? new Date() } },
    },
    include: { enrichment: true },
  });
  return { intakeId: intake.id, enrichmentId: intake.enrichment!.id };
}

beforeEach(async () => {
  await db.intake.deleteMany();
});

afterAll(async () => {
  await db.$disconnect();
});

describe('claim', () => {
  it('hands the same row to only one of two workers racing for it', async () => {
    await seedIntake();

    const a = new SqliteJobStore(db, 'worker-a', 60_000);
    const b = new SqliteJobStore(db, 'worker-b', 60_000);

    const [first, second] = await Promise.all([a.claim(1), b.claim(1)]);

    expect(first.length + second.length).toBe(1);
  });

  it('leaves a row alone until nextAttemptAt has passed', async () => {
    await seedIntake({ nextAttemptAt: new Date(Date.now() + 60_000) });

    const store = new SqliteJobStore(db, 'worker-a', 60_000);

    expect(await store.claim(5)).toHaveLength(0);
  });

  it('counts the attempt when it claims', async () => {
    const { enrichmentId } = await seedIntake();
    const store = new SqliteJobStore(db, 'worker-a', 60_000);

    const [job] = await store.claim(1);

    expect(job.attempts).toBe(1);
    const row = await db.enrichment.findUniqueOrThrow({ where: { id: enrichmentId } });
    expect(row.state).toBe('PROCESSING');
    expect(row.lockedBy).toBe('worker-a');
  });
});

describe('reap', () => {
  it('returns a row with a lapsed lease to PENDING', async () => {
    const { enrichmentId } = await seedIntake();
    const store = new SqliteJobStore(db, 'worker-a', -1_000);

    await store.claim(1);
    expect(await store.reap()).toBe(1);

    const row = await db.enrichment.findUniqueOrThrow({ where: { id: enrichmentId } });
    expect(row.state).toBe('PENDING');
    expect(row.lockToken).toBeNull();
  });

  it('leaves a live lease alone', async () => {
    await seedIntake();
    const store = new SqliteJobStore(db, 'worker-a', 60_000);

    await store.claim(1);

    expect(await store.reap()).toBe(0);
  });
});

describe('the fencing token', () => {
  it('rejects a reaped worker writing its result late, and keeps the live one', async () => {
    const { enrichmentId } = await seedIntake();
    const slow = new SqliteJobStore(db, 'worker-slow', -1_000);
    const fast = new SqliteJobStore(db, 'worker-fast', 60_000);

    const [stale] = await slow.claim(1);
    await fast.reap();
    const [fresh] = await fast.claim(1);

    expect(await slow.complete(enrichmentId, stale.lockToken, result('stale'))).toBe(false);
    expect(await fast.complete(enrichmentId, fresh.lockToken, result('live'))).toBe(true);

    const row = await db.enrichment.findUniqueOrThrow({ where: { id: enrichmentId } });
    expect(row.summary).toBe('live');
    expect(row.state).toBe('READY');
  });

  it('tells a worker its heartbeat no longer holds the lease', async () => {
    const { enrichmentId } = await seedIntake();
    const slow = new SqliteJobStore(db, 'worker-slow', -1_000);
    const fast = new SqliteJobStore(db, 'worker-fast', 60_000);

    const [stale] = await slow.claim(1);
    await fast.reap();
    await fast.claim(1);

    expect(await slow.heartbeat(enrichmentId, stale.lockToken)).toBe(false);
  });

  it('rejects a stale failure write too', async () => {
    const { enrichmentId } = await seedIntake();
    const slow = new SqliteJobStore(db, 'worker-slow', -1_000);
    const fast = new SqliteJobStore(db, 'worker-fast', 60_000);

    const [stale] = await slow.claim(1);
    await fast.reap();
    await fast.claim(1);

    expect(await slow.fail(enrichmentId, stale.lockToken, { error: 'boom' })).toBe(false);

    const row = await db.enrichment.findUniqueOrThrow({ where: { id: enrichmentId } });
    expect(row.state).toBe('PROCESSING');
    expect(row.error).toBeNull();
  });
});

describe('complete', () => {
  it('replaces the tags rather than adding to them', async () => {
    const { intakeId, enrichmentId } = await seedIntake();
    const store = new SqliteJobStore(db, 'worker-a', 60_000);

    const [first] = await store.claim(1);
    await store.complete(enrichmentId, first.lockToken, result('first', ['old-one', 'old-two']));

    await db.enrichment.update({
      where: { id: enrichmentId },
      data: { state: 'PENDING', nextAttemptAt: new Date() },
    });
    const [second] = await store.claim(1);
    await store.complete(enrichmentId, second.lockToken, result('second', ['new-one']));

    const tags = await db.tag.findMany({ where: { intakeId } });
    expect(tags.map((t) => t.label)).toEqual(['new-one']);
  });

  it('logs FALLBACK rather than READY when the result came from the fallback', async () => {
    const { intakeId, enrichmentId } = await seedIntake();
    const store = new SqliteJobStore(db, 'worker-a', 60_000);

    const [job] = await store.claim(1);
    await store.complete(enrichmentId, job.lockToken, {
      ...result('degraded'),
      source: 'FALLBACK',
    });

    const events = await db.event.findMany({ where: { intakeId }, orderBy: { seq: 'asc' } });
    expect(events.map((e) => e.type)).toContain('FALLBACK');
  });
});

describe('fail', () => {
  it('schedules a retry in the future and puts the row back', async () => {
    const { intakeId, enrichmentId } = await seedIntake();
    const store = new SqliteJobStore(db, 'worker-a', 60_000);

    const [job] = await store.claim(1);
    const retryAt = new Date(Date.now() + 5_000);
    await store.fail(enrichmentId, job.lockToken, { error: 'upstream 503', retryAt });

    const row = await db.enrichment.findUniqueOrThrow({ where: { id: enrichmentId } });
    expect(row.state).toBe('PENDING');
    expect(row.error).toBe('upstream 503');
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(row.attempts).toBe(1);

    const events = await db.event.findMany({ where: { intakeId } });
    expect(events.map((e) => e.type)).toContain('RETRY_SCHEDULED');
  });

  it('marks the row FAILED when there is no retry left', async () => {
    const { intakeId, enrichmentId } = await seedIntake();
    const store = new SqliteJobStore(db, 'worker-a', 60_000);

    const [job] = await store.claim(1);
    await store.fail(enrichmentId, job.lockToken, { error: 'bad api key' });

    const row = await db.enrichment.findUniqueOrThrow({ where: { id: enrichmentId } });
    expect(row.state).toBe('FAILED');
    expect(row.lockToken).toBeNull();

    const events = await db.event.findMany({ where: { intakeId } });
    expect(events.map((e) => e.type)).toContain('FAILED');
  });
});

describe('release', () => {
  it('hands the job straight back without burning an attempt', async () => {
    const { enrichmentId } = await seedIntake();
    const store = new SqliteJobStore(db, 'worker-a', 60_000);

    const [job] = await store.claim(1);
    expect(await store.release(enrichmentId, job.lockToken)).toBe(true);

    const row = await db.enrichment.findUniqueOrThrow({ where: { id: enrichmentId } });
    expect(row.state).toBe('PENDING');
    expect(row.attempts).toBe(1);
    expect(row.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
