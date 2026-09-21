import { z } from 'zod';
import { EVENT_TYPES } from './events';

// Long enough not to be chatty, short enough that the idle timeouts proxies default to
// (commonly 30s or 60s) never see a silent connection.
export const HEARTBEAT_MS = 15_000;

// Parsed rather than trusted: the reducer runs on whatever a reconnect replays, and one
// malformed row should not take the page down.
export const StreamEventSchema = z.object({
  seq: z.number().int(),
  intakeId: z.string(),
  type: z.enum(EVENT_TYPES),
  payload: z.unknown(),
  createdAt: z.string(),
});

export type StreamEvent = z.infer<typeof StreamEventSchema>;

// No `event:` line, since a named event would not reach onmessage and the type is in the body.
export function encodeFrame(event: StreamEvent): string {
  return `id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function parseFrame(data: string): StreamEvent | null {
  try {
    const parsed = StreamEventSchema.safeParse(JSON.parse(data));
    if (parsed.success) return parsed.data;
    console.error('[stream] dropped a frame that did not match the schema:', data);
  } catch (err) {
    console.error('[stream] dropped a frame that was not JSON:', data, err);
  }

  return null;
}

// Absent, blank or junk mean "no cursor", because Number(null) and Number('') are 0 and would
// replay the whole log.
export function resumePoint(header: string | null): number | undefined {
  if (header === null || header.trim() === '') return undefined;

  const seq = Number(header);
  return Number.isSafeInteger(seq) && seq >= 0 ? seq : undefined;
}
