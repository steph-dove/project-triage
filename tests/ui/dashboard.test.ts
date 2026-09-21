import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDashboard, median } from '../../lib/dashboard';

const db = new PrismaClient();

async function intake(
  status: string,
  enrichment: Record<string, unknown> = {},
  tags: string[] = [],
) {
  return db.intake.create({
    data: {
      title: 'Test intake',
      description: 'A description long enough to be realistic.',
      budgetRange: '$50k-100k',
      timeline: '6 weeks',
      industry: 'Logistics',
      status,
      enrichment: { create: enrichment },
      tags: { create: tags.map((label) => ({ label })) },
    },
  });
}

beforeEach(async () => {
  await db.intake.deleteMany();
  await db.worker.deleteMany();
});

afterAll(async () => {
  await db.$disconnect();
});

describe('median', () => {
  it('takes the middle, or the mean of the middle two', () => {
    expect(median([])).toBeUndefined();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('getDashboard', () => {
  it('reports no fallback share rather than 0% when nothing has finished', async () => {
    await intake('NEW', { state: 'PENDING' });

    const data = await getDashboard();

    expect(data.fallbackShare).toBeUndefined();
    expect(data.queue.medianLatencyMs).toBeUndefined();
    expect(data.queue.concurrency).toBeUndefined();
  });

  it('counts intakes by status, awaiting and failed', async () => {
    await intake('NEW', { state: 'PENDING' });
    await intake('NEW', { state: 'PROCESSING' });
    await intake('IN_REVIEW', { state: 'READY', source: 'LLM' });
    await intake('DECLINED', { state: 'FAILED' });

    const data = await getDashboard();

    expect(data.total).toBe(4);
    expect(data.awaiting).toBe(2);
    expect(data.failed).toBe(1);
    expect(data.queue.inFlight).toBe(1);
    expect(data.byStatus).toEqual([
      { status: 'NEW', count: 2 },
      { status: 'IN_REVIEW', count: 1 },
      { status: 'ACCEPTED', count: 0 },
      { status: 'DECLINED', count: 1 },
    ]);
  });

  it('shares fallbacks out of finished results only', async () => {
    await intake('NEW', { state: 'READY', source: 'FALLBACK' });
    for (let i = 0; i < 3; i += 1) await intake('NEW', { state: 'READY', source: 'LLM' });
    await intake('NEW', { state: 'FAILED', source: 'FALLBACK' });
    await intake('NEW', { state: 'PENDING' });

    expect((await getDashboard()).fallbackShare).toBe(0.25);
  });

  it('ranks the top five tags, breaking ties by name', async () => {
    await intake('NEW', {}, ['b', 'a', 'f']);
    await intake('NEW', {}, ['b', 'c', 'e']);
    await intake('NEW', {}, ['b', 'd', 'a']);

    expect((await getDashboard()).topTags).toEqual([
      { label: 'b', count: 3 },
      { label: 'a', count: 2 },
      { label: 'c', count: 1 },
      { label: 'd', count: 1 },
      { label: 'e', count: 1 },
    ]);
  });

  it('takes the median latency of model results, ignoring fallbacks', async () => {
    await intake('NEW', { state: 'READY', source: 'LLM', latencyMs: 1000 });
    await intake('NEW', { state: 'READY', source: 'LLM', latencyMs: 3000 });
    await intake('NEW', { state: 'READY', source: 'LLM', latencyMs: 2000 });
    await intake('NEW', { state: 'READY', source: 'FALLBACK', latencyMs: 90_000 });

    expect((await getDashboard()).queue.medianLatencyMs).toBe(2000);
  });

  it('counts only live workers, and their concurrency', async () => {
    const soon = new Date(Date.now() + 60_000);
    await db.worker.createMany({
      data: [
        { id: 'a', concurrency: 4, expiresAt: soon },
        { id: 'b', concurrency: 2, expiresAt: soon },
        { id: 'gone', concurrency: 8, expiresAt: new Date(Date.now() - 1_000) },
      ],
    });

    const { queue } = await getDashboard();

    expect(queue.workersOnline).toBe(2);
    expect(queue.concurrency).toEqual({ min: 2, max: 4 });
  });

  it('counts retries scheduled in the last 24 hours', async () => {
    const { id } = await intake('NEW');
    const now = new Date();
    const yesterday = new Date(now.getTime() - 25 * 60 * 60_000);

    await db.event.createMany({
      data: [
        { intakeId: id, type: 'RETRY_SCHEDULED', createdAt: now },
        { intakeId: id, type: 'RETRY_SCHEDULED', createdAt: now },
        { intakeId: id, type: 'RETRY_SCHEDULED', createdAt: yesterday },
        { intakeId: id, type: 'FAILED', createdAt: now },
      ],
    });

    expect((await getDashboard(now)).queue.recentRetries).toBe(2);
  });
});
