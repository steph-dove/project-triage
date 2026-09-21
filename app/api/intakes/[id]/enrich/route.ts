import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getIntake } from '@/lib/intakes';
import { requeueIntake } from '@/lib/queue/sqlite-store';

type Params = { params: Promise<{ id: string }> };

// Retrying is re-enqueueing: the worker owns everything after this, so the handler only has to
// decide whether the row is allowed back on the queue.
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;

  const exists = await db.intake.findUnique({ where: { id }, select: { id: true } });
  if (!exists) {
    return NextResponse.json({ error: 'No intake with that id.' }, { status: 404 });
  }

  if (!(await requeueIntake(db, id))) {
    return NextResponse.json(
      { error: 'That analysis is already queued. Give it a moment.' },
      { status: 409 },
    );
  }

  const intake = await getIntake(id);
  if (!intake) {
    return NextResponse.json({ error: 'No intake with that id.' }, { status: 404 });
  }

  return NextResponse.json(intake);
}
