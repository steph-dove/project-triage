import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { listIntakes } from '../../lib/intakes';
import { ListIntakesQuerySchema, MAX_PAGE, type TriageStatus } from '../../lib/schemas';

const db = new PrismaClient();

const query = (params: Record<string, string> = {}) => ListIntakesQuerySchema.parse(params);

async function seed(count: number, status: TriageStatus = 'NEW') {
  const now = Date.now();

  for (let i = 0; i < count; i += 1) {
    await db.intake.create({
      data: {
        title: `Intake ${i}`,
        description: 'A description long enough to be realistic for the triage summary.',
        budgetRange: '$50k-100k',
        timeline: '6 weeks',
        industry: 'Logistics',
        status,
        // Spread apart so the newest-first ordering is unambiguous.
        createdAt: new Date(now - (count - i) * 60_000),
        enrichment: { create: {} },
      },
    });
  }
}

beforeEach(async () => {
  await db.intake.deleteMany();
});

afterAll(async () => {
  await db.$disconnect();
});

describe('listIntakes', () => {
  it('returns one page at a time, newest first', async () => {
    await seed(14);

    const page1 = await listIntakes(query());
    expect(page1.items).toHaveLength(10);
    expect(page1.total).toBe(14);
    expect(page1.totalPages).toBe(2);
    expect(page1.items[0].title).toBe('Intake 13');

    const page2 = await listIntakes(query({ page: '2' }));
    expect(page2.items).toHaveLength(4);
    expect(page2.items[0].title).toBe('Intake 3');
  });

  it('reports one page, not zero, when there is nothing to show', async () => {
    const list = await listIntakes(query());

    expect(list.items).toEqual([]);
    expect(list.total).toBe(0);
    // Zero would render "Page 1 of 0" in the pagination footer.
    expect(list.totalPages).toBe(1);
    expect(list.totalAll).toBe(0);
  });

  it('comes back empty rather than throwing on a page past the end', async () => {
    await seed(3);

    const list = await listIntakes(query({ page: String(MAX_PAGE) }));
    expect(list.items).toEqual([]);
    expect(list.total).toBe(3);
  });

  it('counts every status even when the list itself is filtered', async () => {
    await seed(2, 'NEW');
    await seed(3, 'ACCEPTED');

    const list = await listIntakes(query({ status: 'ACCEPTED' }));

    expect(list.items).toHaveLength(3);
    expect(list.total).toBe(3);
    // Unfiltered on purpose: the chips show what switching filter would give you.
    expect(list.counts).toEqual({ NEW: 2, IN_REVIEW: 0, ACCEPTED: 3, DECLINED: 0 });
    expect(list.totalAll).toBe(5);
  });
});

describe('ListIntakesQuerySchema', () => {
  it('clamps a page number too large for the database to offset by', () => {
    expect(query({ page: '99999999999999999999' }).page).toBe(MAX_PAGE);
  });

  it('falls back instead of rejecting junk in the URL bar', () => {
    expect(query({ page: 'abc', status: 'nonsense' })).toMatchObject({
      page: 1,
      pageSize: 10,
      status: undefined,
    });
  });

  it('caps pageSize so the endpoint cannot dump the whole table', () => {
    expect(query({ pageSize: '5000' }).pageSize).toBe(50);
    expect(query({ pageSize: '0' }).pageSize).toBe(1);
  });
});
