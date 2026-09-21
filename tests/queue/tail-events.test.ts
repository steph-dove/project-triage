import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { EventType } from '../../lib/events';
import { tailEvents } from '../../lib/queue/sqlite-store';
import type { QueueEvent } from '../../lib/queue/types';

const db = new PrismaClient();

async function intakeWith(title: string, types: EventType[]) {
  const intake = await db.intake.create({
    data: {
      title,
      description: 'Enough description to look like a real intake for the triage summary.',
      budgetRange: '$50k-100k',
      timeline: '6 weeks',
      industry: 'Logistics',
      enrichment: { create: {} },
      events: { create: types.map((type) => ({ type })) },
    },
    select: { id: true },
  });

  return intake.id;
}

// The first tick fires immediately, so one turn of the loop is enough to see everything that
// was already in the table.
function collect(options: Parameters<typeof tailEvents>[1]): Promise<QueueEvent[]> {
  return new Promise((resolve, reject) => {
    const seen: QueueEvent[] = [];
    const subscription = tailEvents(db, options, {
      onEvent: (event) => seen.push(event),
      onError: (err) => {
        subscription.stop();
        reject(err);
      },
    });

    setTimeout(() => {
      subscription.stop();
      resolve(seen);
    }, 150);
  });
}

beforeEach(async () => {
  await db.intake.deleteMany();
});

afterAll(async () => {
  await db.$disconnect();
});

describe('tailEvents', () => {
  it('sends one intake only its own rows', async () => {
    const watched = await intakeWith('Watched', ['QUEUED', 'CLAIMED', 'READY']);
    await intakeWith('Somebody else', ['QUEUED', 'CLAIMED', 'READY']);

    const seen = await collect({ sinceSeq: 0, intakeId: watched });

    expect(seen).toHaveLength(3);
    expect(seen.every((event) => event.intakeId === watched)).toBe(true);
  });

  it('narrows to the requested types at the query, so the rest are never built', async () => {
    await intakeWith('Chatty', ['QUEUED', 'CALLING_MODEL', 'PARTIAL', 'PARTIAL', 'READY']);

    const seen = await collect({ sinceSeq: 0, types: ['QUEUED', 'READY'] });

    expect(seen.map((event) => event.type)).toEqual(['QUEUED', 'READY']);
  });

  it('starts after the cursor, not at the beginning', async () => {
    const id = await intakeWith('Resumed', ['QUEUED', 'CLAIMED', 'READY']);
    const rows = await db.event.findMany({ where: { intakeId: id }, orderBy: { seq: 'asc' } });

    const seen = await collect({ sinceSeq: rows[0].seq, intakeId: id });

    expect(seen.map((event) => event.type)).toEqual(['CLAIMED', 'READY']);
  });

  it('stops delivering once it is stopped', async () => {
    const id = await intakeWith('Stopped', ['QUEUED']);

    const seen: QueueEvent[] = [];
    const subscription = tailEvents(db, { sinceSeq: 0, intakeId: id }, {
      onEvent: (event) => seen.push(event),
    });
    subscription.stop();

    await db.event.create({ data: { intakeId: id, type: 'READY' } });
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(seen.map((event) => event.type)).not.toContain('READY');
  });
});
