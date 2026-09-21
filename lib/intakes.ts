import type { Prisma } from '@prisma/client';
import type { EnrichmentState, TriageStatus } from './schemas';

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
      attempts: true,
      error: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.IntakeSelect;

type IntakeRow = Prisma.IntakeGetPayload<{ select: typeof intakeSelect }>;

export type SerializedIntake = ReturnType<typeof serializeIntake>;

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
