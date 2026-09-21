import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { emit } from '@/lib/events';
import { intakeSelect, listIntakes, serializeIntake } from '@/lib/intakes';
import { CreateIntakeSchema, ListIntakesQuerySchema } from '@/lib/schemas';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = ListIntakesQuerySchema.parse({
    page: params.get('page') ?? undefined,
    pageSize: params.get('pageSize') ?? undefined,
    status: params.get('status') ?? undefined,
  });

  return NextResponse.json(await listIntakes(query));
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const parsed = CreateIntakeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Some fields need fixing.',
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  // Writing the PENDING enrichment row is the enqueue, so it commits with the intake or not
  // at all. An intake without one would never be analysed.
  const intake = await db.$transaction(async (tx) => {
    const created = await tx.intake.create({
      data: { ...parsed.data, enrichment: { create: {} } },
      select: intakeSelect,
    });
    await emit(tx, created.id, 'QUEUED');
    return created;
  });

  return NextResponse.json(serializeIntake(intake), { status: 201 });
}
