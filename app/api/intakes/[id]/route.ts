import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { emit } from '@/lib/events';
import { getIntake, intakeSelect, serializeIntake } from '@/lib/intakes';
import { UpdateIntakeSchema } from '@/lib/schemas';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;

  const intake = await getIntake(id);
  if (!intake) {
    return NextResponse.json({ error: 'No intake with that id.' }, { status: 404 });
  }

  return NextResponse.json(intake);
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const parsed = UpdateIntakeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Some fields need fixing.', fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const existing = await db.intake.findUnique({ where: { id }, select: { status: true } });
  if (!existing) {
    return NextResponse.json({ error: 'No intake with that id.' }, { status: 404 });
  }

  const { status } = parsed.data;

  // No event for a no-op, or double-clicking a status button fills the log with NEW to NEW.
  if (existing.status === status) {
    const unchanged = await db.intake.findUniqueOrThrow({ where: { id }, select: intakeSelect });
    return NextResponse.json(serializeIntake(unchanged));
  }

  const intake = await db.$transaction(async (tx) => {
    const updated = await tx.intake.update({
      where: { id },
      data: { status },
      select: intakeSelect,
    });
    // Through the event log so open browsers get it on the worker's stream.
    await emit(tx, id, 'STATUS_CHANGED', { from: existing.status, to: status });
    return updated;
  });

  return NextResponse.json(serializeIntake(intake));
}
