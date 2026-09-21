import { db } from '@/lib/db';
import { BOM, toCsv } from '@/lib/csv';

export const dynamic = 'force-dynamic';

// Streamed a page at a time, so the export never holds every description in memory at once.
const BATCH = 500;

const HEADER = [
  'id',
  'title',
  'description',
  'industry',
  'budget_range',
  'timeline',
  'status',
  'created_at',
  'analysis_state',
  'analysis_source',
  'summary',
  'tags',
  'risks',
];

const select = {
  id: true,
  title: true,
  description: true,
  industry: true,
  budgetRange: true,
  timeline: true,
  status: true,
  createdAt: true,
  tags: { select: { label: true }, orderBy: { label: 'asc' } },
  // Not error or rawResponse: both can carry provider text, and neither is a triage fact.
  enrichment: { select: { state: true, source: true, summary: true, risks: true } },
} as const;

// Takes no request on purpose: an export is the whole dataset, whatever page or filter the
// button was clicked from.
export async function GET() {
  const encoder = new TextEncoder();
  let cursor: string | undefined;
  // Set when the browser gives up on the download, so a batch still in flight does not try to
  // write to a closed stream and log a failure that never happened.
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Excel reads a file without the BOM as Windows-1252 and mangles every accent.
      controller.enqueue(encoder.encode(BOM + toCsv([HEADER])));
    },

    async pull(controller) {
      try {
        // No transaction: on SQLite it's BEGIN IMMEDIATE and would stall the workers for the whole
        // download. The cost is that a row finished mid-batch can pair new tags with old state.
        const batch = await db.intake.findMany({
          select,
          // id breaks createdAt ties, so the cursor never skips or repeats a row.
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: BATCH,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (cancelled) return;

        if (batch.length > 0) controller.enqueue(encoder.encode(toCsv(batch.map(toRow))));
        if (batch.length < BATCH) {
          controller.close();
          return;
        }
        cursor = batch.at(-1)!.id;
      } catch (err) {
        if (cancelled) return;
        // The 200 has already gone out, so erroring the stream is the only way to tell the
        // browser this download is incomplete rather than let it save a truncated file.
        console.error('[export] failed partway through the CSV', err);
        controller.error(err);
      }
    },

    cancel() {
      cancelled = true;
    },
  });

  const date = new Date().toISOString().slice(0, 10);

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="intakes-${date}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

type Row = Awaited<ReturnType<typeof db.intake.findMany<{ select: typeof select }>>>[number];

function toRow(intake: Row) {
  return [
    intake.id,
    intake.title,
    intake.description,
    intake.industry,
    intake.budgetRange,
    intake.timeline,
    intake.status,
    intake.createdAt.toISOString(),
    intake.enrichment?.state,
    intake.enrichment?.source,
    intake.enrichment?.summary,
    intake.tags.map((tag) => tag.label).join('; '),
    risksCell(intake.enrichment?.risks ?? null),
  ];
}

function risksCell(raw: string | null): string {
  if (!raw) return '';

  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.join('; ');
  } catch (err) {
    console.error('[export] could not parse risks JSON, exporting it as stored:', err);
  }

  return raw;
}
