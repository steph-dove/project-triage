import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveCursor } from '../../lib/stream-cursor';
import type { EventType } from '../../lib/events';

const db = new PrismaClient();

const request = (lastEventId?: string) =>
  new Request('http://localhost/api/stream', {
    headers: lastEventId ? { 'Last-Event-ID': lastEventId } : {},
  });

async function intakeWith(types: EventType[]) {
  const intake = await db.intake.create({
    data: {
      title: 'Clinical trial document intake automation',
      description: 'Document intake for clinical trials is keyed in by hand.',
      budgetRange: 'Not decided yet',
      timeline: 'ASAP',
      industry: 'Healthcare',
      enrichment: { create: {} },
      events: { create: types.map((type) => ({ type })) },
    },
    select: { id: true, events: { select: { seq: true, type: true }, orderBy: { seq: 'asc' } } },
  });

  return intake;
}

beforeEach(async () => {
  await db.intake.deleteMany();
});

afterAll(async () => {
  await db.$disconnect();
});

describe('resolveCursor', () => {
  it('starts a detail page at the run it is watching, not the one before it', async () => {
    const { id, events } = await intakeWith([
      'QUEUED',
      'CLAIMED',
      'FAILED',
      'QUEUED',
      'CLAIMED',
    ]);
    const retryQueued = events[3];

    // Exclusive, so the next row the tail reads is that QUEUED itself.
    expect(await resolveCursor(request(), { intakeId: id })).toBe(retryQueued.seq - 1);
  });

  it('replays everything for an intake that has no QUEUED to anchor on', async () => {
    const { id } = await intakeWith(['CLAIMED']);

    expect(await resolveCursor(request(), { intakeId: id })).toBe(0);
  });

  it('starts a list page at the tip, because the page just rendered current state', async () => {
    const { events } = await intakeWith(['QUEUED', 'READY']);
    const newest = events[events.length - 1];

    expect(await resolveCursor(request(), {})).toBe(newest.seq);
  });

  it('prefers the cursor the page rendered at over the live tip', async () => {
    const { events } = await intakeWith(['QUEUED', 'CLAIMED', 'READY']);
    const rendered = events[0];

    // The list page renders, then hydrates, then connects. Anything that landed in between is
    // lost if the stream starts at the tip instead of where the page was drawn.
    expect(await resolveCursor(request(), { sinceSeq: String(rendered.seq) })).toBe(rendered.seq);
  });

  it('ignores a junk sinceSeq rather than replaying everything', async () => {
    const { events } = await intakeWith(['QUEUED', 'READY']);
    const newest = events[events.length - 1];

    expect(await resolveCursor(request(), { sinceSeq: 'yesterday' })).toBe(newest.seq);
  });

  it('resumes from the cursor a reconnect sends, whichever stream it is', async () => {
    const { id } = await intakeWith(['QUEUED', 'CLAIMED', 'READY']);

    expect(await resolveCursor(request('7'), { intakeId: id })).toBe(7);
    expect(await resolveCursor(request('7'), {})).toBe(7);
    // Even against a sinceSeq: the browser knows better than the render did.
    expect(await resolveCursor(request('7'), { sinceSeq: '2' })).toBe(7);
  });
});
