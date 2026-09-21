import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { emit } from '@/lib/events';
import { intakeSelect, serializeIntake } from '@/lib/intakes';
import { CreateIntakeSchema, ListIntakesQuerySchema, TRIAGE_STATUSES } from '@/lib/schemas';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const { page, pageSize, status } = ListIntakesQuerySchema.parse({
    page: params.get('page') ?? undefined,
    pageSize: params.get('pageSize') ?? undefined,
    status: params.get('status') ?? undefined,
  });

  const where = status ? { status } : {};

  const [rows, total, grouped] = await Promise.all([
    db.intake.findMany({
      where,
      select: intakeSelect,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.intake.count({ where }),
    // Unfiltered on purpose: the chips show what you would get by switching filter.
    db.intake.groupBy({ by: ['status'], _count: true }),
  ]);

  const counts = Object.fromEntries(TRIAGE_STATUSES.map((s) => [s, 0])) as Record<
    (typeof TRIAGE_STATUSES)[number],
    number
  >;
  for (const row of grouped) {
    if (row.status in counts) counts[row.status as keyof typeof counts] = row._count;
  }

  return NextResponse.json({
    items: rows.map(serializeIntake),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    counts,
    totalAll: Object.values(counts).reduce((a, b) => a + b, 0),
  });
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
