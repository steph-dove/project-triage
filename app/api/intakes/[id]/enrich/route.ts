import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { emit } from '@/lib/events';
import { intakeSelect, serializeIntake } from '@/lib/intakes';
import { releasedLock } from '@/lib/queue/sqlite-store';

type Params = { params: Promise<{ id: string }> };

// Retrying is re-enqueueing: the worker owns the rest, so this only has to make the row
// claimable again and say so on the stream.
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;

  const intake = await db.intake.findUnique({ where: { id }, select: { id: true } });
  if (!intake) {
    return NextResponse.json({ error: 'No intake with that id.' }, { status: 404 });
  }

  const requeued = await db.$transaction(async (tx) => {
    // Compare-and-swap rather than a read then a write: two impatient clicks arriving together
    // would both pass a separate check and queue the same work twice.
    const { count } = await tx.enrichment.updateMany({
      where: { intakeId: id, state: { in: ['READY', 'FAILED'] } },
      data: {
        state: 'PENDING',
        attempts: 0,
        error: null,
        nextAttemptAt: new Date(),
        ...releasedLock,
      },
    });
    if (count === 0) return null;

    await emit(tx, id, 'QUEUED', { retry: true });
    return tx.intake.findUniqueOrThrow({ where: { id }, select: intakeSelect });
  });

  // Summary and tags are left alone so a retry that fails hard cannot destroy a usable fallback.
  if (!requeued) {
    return NextResponse.json(
      { error: 'That analysis is already queued. Give it a moment.' },
      { status: 409 },
    );
  }

  return NextResponse.json(serializeIntake(requeued));
}
