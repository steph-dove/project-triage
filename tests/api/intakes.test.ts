import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from '../../app/api/intakes/route';

const db = new PrismaClient();

const valid = {
  title: 'Warehouse routing optimisation pilot',
  description: 'Route planning is done by hand each morning in spreadsheets by two people.',
  budgetRange: '$50k-100k',
  timeline: '6 weeks',
  industry: 'Logistics',
};

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/intakes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

const list = async (query = '') => {
  const response = await GET(new Request(`http://localhost/api/intakes${query}`));
  expect(response.status).toBe(200);
  return response.json();
};

async function seed(count: number) {
  const now = Date.now();
  for (let i = 0; i < count; i += 1) {
    await db.intake.create({
      data: {
        ...valid,
        title: `Intake ${i}`,
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

describe('POST /api/intakes', () => {
  it('201s and persists the intake with its job and the QUEUED event', async () => {
    const response = await post(valid);
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body).toMatchObject({ ...valid, status: 'NEW', tags: [] });
    expect(body.enrichment).toMatchObject({ state: 'PENDING', attempts: 0 });

    const stored = await db.intake.findUniqueOrThrow({
      where: { id: body.id },
      include: { enrichment: true, events: true },
    });
    expect(stored).toMatchObject(valid);
    expect(stored.enrichment?.state).toBe('PENDING');
    expect(stored.events.map((e) => e.type)).toEqual(['QUEUED']);
  });

  it('trims the fields before saving them', async () => {
    const response = await post({ ...valid, title: '  Padded title  ', industry: ' Retail ' });
    const body = await response.json();

    expect(body.title).toBe('Padded title');
    expect(body.industry).toBe('Retail');
  });

  it('400s with a message per field and saves nothing', async () => {
    const response = await post({ ...valid, title: '   ', description: 'Too short.', timeline: 7 });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe('Some fields need fixing.');
    expect(Object.keys(body.fieldErrors).sort()).toEqual(['description', 'timeline', 'title']);
    expect(body.fieldErrors.title).toEqual(['Give the request a title.']);
    expect(body.fieldErrors.description[0]).toMatch(/at least 40 characters/);

    expect(await db.intake.count()).toBe(0);
    expect(await db.event.count()).toBe(0);
  });

  it('names every missing field on an empty body', async () => {
    const body = await (await post({})).json();

    expect(Object.keys(body.fieldErrors).sort()).toEqual([
      'budgetRange',
      'description',
      'industry',
      'timeline',
      'title',
    ]);
  });

  it('400s a body that is not JSON', async () => {
    const response = await post('title=not+json');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Request body must be JSON.' });
  });
});

describe('GET /api/intakes pagination', () => {
  it('fills the last page exactly when the total divides evenly', async () => {
    await seed(20);

    const page2 = await list('?page=2');
    expect(page2).toMatchObject({ page: 2, pageSize: 10, total: 20, totalPages: 2 });
    expect(page2.items).toHaveLength(10);
    expect(page2.items.at(-1).title).toBe('Intake 0');

    const page3 = await list('?page=3');
    expect(page3.items).toEqual([]);
    expect(page3.totalPages).toBe(2);
  });

  it('starts a new page at the first row past the boundary', async () => {
    await seed(11);

    const page2 = await list('?page=2');
    expect(page2.totalPages).toBe(2);
    expect(page2.items.map((i: { title: string }) => i.title)).toEqual(['Intake 0']);
  });

  it('never repeats or skips a row across pages', async () => {
    await seed(23);

    const titles: string[] = [];
    for (const page of [1, 2, 3]) {
      const body = await list(`?page=${page}`);
      titles.push(...body.items.map((i: { title: string }) => i.title));
    }

    expect(titles).toHaveLength(23);
    expect(new Set(titles).size).toBe(23);
  });

  it.each([
    ['51', 50],
    ['5000', 50],
    ['0', 1],
    ['-3', 1],
    ['abc', 10],
  ])('clamps pageSize=%s to %i', async (pageSize, expected) => {
    await seed(60);

    const body = await list(`?pageSize=${pageSize}`);

    expect(body.pageSize).toBe(expected);
    expect(body.items).toHaveLength(expected);
  });

  it.each(['0', '-1', 'abc'])('treats page=%s as the first page', async (page) => {
    await seed(3);

    const body = await list(`?page=${page}`);

    expect(body.page).toBe(1);
    expect(body.items).toHaveLength(3);
  });

  it('pages within a status filter, not across the whole table', async () => {
    await seed(12);
    const accepted = await db.intake.findMany({ orderBy: { createdAt: 'asc' }, take: 3 });
    await db.intake.updateMany({
      where: { id: { in: accepted.map((i) => i.id) } },
      data: { status: 'ACCEPTED' },
    });

    const body = await list('?status=ACCEPTED&pageSize=2&page=2');

    expect(body).toMatchObject({ total: 3, totalPages: 2 });
    expect(body.items.map((i: { title: string }) => i.title)).toEqual(['Intake 0']);
  });
});
