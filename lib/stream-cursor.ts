import { db } from './db';
import { resumePoint } from './stream';

/**
 * Where a new /api/stream connection starts reading; a reconnect resumes where it got to.
 *
 * A detail page replays from the last QUEUED so an earlier run's FAILED cannot settle the
 * stepper; a list page starts at the tip, since the server just rendered current state.
 */
export async function resolveCursor(request: Request, intakeId?: string): Promise<number> {
  const resumeFrom = resumePoint(request.headers.get('Last-Event-ID'));
  if (resumeFrom !== undefined) return resumeFrom;

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
