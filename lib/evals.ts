import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { parseRisks } from './intakes';

// One line per finished analysis (input, raw response, saved result, cost), to be scored later.
export async function dumpEvals(db: PrismaClient, dir: string, now = new Date()) {
  const rows = await db.enrichment.findMany({
    // PENDING and PROCESSING rows have nothing to score yet.
    where: { state: { in: ['READY', 'FAILED'] } },
    orderBy: { updatedAt: 'asc' },
    include: {
      intake: {
        select: {
          id: true,
          title: true,
          description: true,
          budgetRange: true,
          timeline: true,
          industry: true,
          tags: { select: { label: true } },
        },
      },
    },
  });

  const lines = rows.map((row) =>
    JSON.stringify({
      intakeId: row.intake.id,
      input: {
        title: row.intake.title,
        description: row.intake.description,
        budgetRange: row.intake.budgetRange,
        timeline: row.intake.timeline,
        industry: row.intake.industry,
      },
      state: row.state,
      source: row.source,
      model: row.model,
      promptVersion: row.promptVersion,
      attempts: row.attempts,
      error: row.error,
      // Kept as the string the model sent: a body that failed to parse is the interesting case.
      rawResponse: row.rawResponse,
      saved: {
        summary: row.summary,
        tags: row.intake.tags.map((t) => t.label),
        risks: parseRisks(row.risks),
      },
      latencyMs: row.latencyMs,
      tokensIn: row.tokensIn,
      tokensOut: row.tokensOut,
      finishedAt: row.updatedAt.toISOString(),
    }),
  );

  await mkdir(dir, { recursive: true });
  // Colons are not allowed in Windows filenames.
  const stamp = now.toISOString().replace(/\.\d+Z$/, 'Z').replaceAll(':', '-');
  const path = join(dir, `runs-${stamp}.jsonl`);
  await writeFile(path, lines.length > 0 ? `${lines.join('\n')}\n` : '');

  return { path, count: lines.length };
}
