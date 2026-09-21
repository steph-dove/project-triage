import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { POST } from '../../app/api/intakes/[id]/enrich/route';

const db = new PrismaClient();

const retry = (id: string) => POST(new Request('http://localhost/'), {
  params: Promise.resolve({ id }),
});

async function intakeIn(state: string, extra: Record<string, unknown> = {}) {
  const intake = await db.intake.create({
    data: {
      title: 'Warehouse routing optimisation pilot',
      description: 'Route planning is done by hand each morning in spreadsheets.',
      budgetRange: '$50k-100k',
      timeline: '6 weeks',
      industry: 'Logistics',
      enrichment: { create: { state, ...extra } },
    },
    select: { id: true },
  });

  return intake.id;
}

const enrichmentFor = (id: string) => db.enrichment.findUniqueOrThrow({ where: { intakeId: id } });

beforeEach(async () => {
  await db.intake.deleteMany();
});

afterAll(async () => {
  await db.$disconnect();
});

describe('POST /api/intakes/[id]/enrich', () => {
  it('makes a failed row claimable again and says so on the stream', async () => {
    const id = await intakeIn('FAILED', {
      attempts: 3,
      error: 'invalid API credentials',
      lockedBy: 'worker-1',
      lockToken: 'token-1',
      leaseExpiresAt: new Date(),
    });

    const response = await retry(id);
    expect(response.status).toBe(200);

    const enrichment = await enrichmentFor(id);
    expect(enrichment.state).toBe('PENDING');
    expect(enrichment.attempts).toBe(0);
    expect(enrichment.error).toBeNull();
    expect(enrichment.lockToken).toBeNull();
    expect(enrichment.leaseExpiresAt).toBeNull();
    expect(enrichment.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now());

    const events = await db.event.findMany({ where: { intakeId: id } });
    expect(events.map((e) => e.type)).toEqual(['QUEUED']);
  });

  it('leaves a fallback result in place, so a retry that fails hard loses nothing', async () => {
    const id = await intakeIn('READY', {
      source: 'FALLBACK',
      summary: 'A healthcare request concerning document intake automation.',
      risks: JSON.stringify(['No budget range supplied']),
    });

    await retry(id);

    const enrichment = await enrichmentFor(id);
    expect(enrichment.summary).toBe('A healthcare request concerning document intake automation.');
    expect(enrichment.source).toBe('FALLBACK');
  });

  it.each(['PENDING', 'PROCESSING'])('refuses to queue a %s row twice', async (state) => {
    const id = await intakeIn(state);

    const response = await retry(id);

    expect(response.status).toBe(409);
    expect(await db.event.count({ where: { intakeId: id } })).toBe(0);
  });

  it('lets exactly one of two simultaneous clicks through', async () => {
    const id = await intakeIn('FAILED', { attempts: 3 });

    const statuses = (await Promise.all([retry(id), retry(id)]))
      .map((response) => response.status)
      .sort();

    expect(statuses).toEqual([200, 409]);
    expect(await db.event.count({ where: { intakeId: id } })).toBe(1);
  });

  it('404s an id that does not exist', async () => {
    const response = await retry('nope');

    expect(response.status).toBe(404);
  });
});
