import { z } from 'zod';
import { EVENT_TYPES, type EventType } from './events';

// Long enough not to be chatty, short enough that the idle timeouts proxies default to
// (commonly 30s or 60s) never see a silent connection.
export const HEARTBEAT_MS = 15_000;

// Events that change a card; PARTIAL, CALLING_MODEL and VALIDATING stay inside "Analysing".
export const LIST_EVENTS = [
  'QUEUED',
  'CLAIMED',
  'READY',
  'FALLBACK',
  'FAILED',
  'RETRY_SCHEDULED',
  'STATUS_CHANGED',
] as const satisfies readonly EventType[];

// Only the fields the client reducer reads. The stored payload also carries workerId, provider,
// model and the raw provider error, which are there for the audit trail rather than for every
// browser watching the list.
export const PAYLOAD_FIELDS: Partial<Record<EventType, readonly string[]>> = {
  PARTIAL: ['summary'],
  FAILED: ['error'],
  RETRY_SCHEDULED: ['error'],
};

/**
 * Whitelists a stored payload down to what the client reducer reads.
 *
 * A stored payload can hold the raw provider error, and OpenAI's own 401 text quotes the
 * partially masked key back at you. The unfiltered stream carries every intake in the system,
 * so this is not something to hand to every browser watching the list.
 */
export function projectPayload(type: EventType, payload: unknown): unknown {
  const fields = PAYLOAD_FIELDS[type];
  if (!fields || typeof payload !== 'object' || payload === null) return null;

  const source = payload as Record<string, unknown>;
  const kept = Object.fromEntries(
    fields.filter((field) => field in source).map((field) => [field, source[field]]),
  );

  return Object.keys(kept).length > 0 ? kept : null;
}

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
