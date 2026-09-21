import { db } from './db';
import { resumePoint } from './stream';

/**
 * Where a new connection to /api/stream should start reading.
 *
 * A reconnect's Last-Event-ID wins outright; otherwise `sinceSeq` says where the page was
 * rendered, so events landing between render and connect are not missed.
 *
 * A detail page with no cursor replays from the last QUEUED, since the stepper's timings come
 * from the event log and an earlier run's FAILED would settle it on a retried-away result.
 * With nothing to go on, start at the tip.
 */
export async function resolveCursor(
  request: Request,
  { intakeId, sinceSeq }: { intakeId?: string; sinceSeq?: string | null } = {},
): Promise<number> {
  const resumeFrom = resumePoint(request.headers.get('Last-Event-ID'));
  if (resumeFrom !== undefined) return resumeFrom;

  const rendered = resumePoint(sinceSeq ?? null);
  if (rendered !== undefined) return rendered;

  if (intakeId) {
    const run = await db.event.findFirst({
      where: { intakeId, type: 'QUEUED' },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    // The cursor is exclusive, and that QUEUED frame is the one the stepper starts from.
    return run ? run.seq - 1 : 0;
  }

  const latest = await db.event.findFirst({ orderBy: { seq: 'desc' }, select: { seq: true } });
  return latest?.seq ?? 0;
}
