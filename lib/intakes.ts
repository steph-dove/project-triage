import type { Prisma } from '@prisma/client';
import { db } from './db';
import {
  TRIAGE_STATUSES,
  type EnrichmentState,
  type ListIntakesQuery,
  type TriageStatus,
} from './schemas';

// Shared by the list and detail endpoints so they cannot drift.
export const intakeSelect = {
  id: true,
  title: true,
  description: true,
  budgetRange: true,
  timeline: true,
  industry: true,
  status: true,
  createdAt: true,
  tags: { select: { label: true } },
  enrichment: {
    select: {
      state: true,
      summary: true,
      risks: true,
      source: true,
      model: true,
      promptVersion: true,
      latencyMs: true,
      attempts: true,
      error: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.IntakeSelect;

type IntakeRow = Prisma.IntakeGetPayload<{ select: typeof intakeSelect }>;

export type SerializedIntake = ReturnType<typeof serializeIntake>;
export type StatusCounts = Record<TriageStatus, number>;

// The route handler and the list page both come through here, so the JSON and the rendered
// page always agree about what page 2 contains.
export async function listIntakes({ page, pageSize, status }: ListIntakesQuery) {
  const where = status ? { status } : {};

  // Read before the rows, not alongside them. The page hands this to the event stream as its
  // starting cursor, and a cursor taken after the read would skip anything that landed in
  // between, leaving a card on "Analysing" with no further event coming for it.
  const latestEvent = await db.event.findFirst({ orderBy: { seq: 'desc' }, select: { seq: true } });

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

  const counts = Object.fromEntries(TRIAGE_STATUSES.map((s) => [s, 0])) as StatusCounts;
  for (const row of grouped) {
    if (row.status in counts) counts[row.status as TriageStatus] = row._count;
  }

  return {
    items: rows.map(serializeIntake),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    counts,
    totalAll: Object.values(counts).reduce((a, b) => a + b, 0),
    sinceSeq: latestEvent?.seq ?? 0,
  };
}

export const isAnalysing = (enrichment: SerializedIntake['enrichment']) =>
  enrichment?.state === 'PENDING' || enrichment?.state === 'PROCESSING';

export async function getIntake(id: string): Promise<SerializedIntake | null> {
  const intake = await db.intake.findUnique({ where: { id }, select: intakeSelect });
  return intake ? serializeIntake(intake) : null;
}

export function serializeIntake(intake: IntakeRow) {
  const { tags, enrichment, createdAt, status, ...rest } = intake;

  return {
    ...rest,
    status: status as TriageStatus,
    createdAt: createdAt.toISOString(),
    tags: tags.map((tag) => tag.label),
    enrichment: enrichment
      ? {
          state: enrichment.state as EnrichmentState,
          summary: enrichment.summary,
          risks: parseRisks(enrichment.risks),
          source: enrichment.source,
          model: enrichment.model,
          promptVersion: enrichment.promptVersion,
          latencyMs: enrichment.latencyMs,
          attempts: enrichment.attempts,
          error: enrichment.error,
          updatedAt: enrichment.updatedAt.toISOString(),
        }
      : null,
  };
}

// A hand-edited or legacy row should not take down the detail page.
function parseRisks(raw: string | null): string[] {
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((r) => typeof r === 'string')) return parsed;
    console.error('[intakes] risks JSON was not an array of strings, ignoring it:', raw);
  } catch (err) {
    console.error('[intakes] could not parse risks JSON, ignoring it:', raw, err);
  }

  return [];
}
