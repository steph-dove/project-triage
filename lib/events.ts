import type { Prisma, PrismaClient } from '@prisma/client';

export const EVENT_TYPES = [
  'QUEUED',
  'CLAIMED',
  'CALLING_MODEL',
  'PARTIAL',
  'VALIDATING',
  'READY',
  'FAILED',
  'FALLBACK',
  'RETRY_SCHEDULED',
  'STATUS_CHANGED',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

// Takes a transaction client so an event commits with the change it describes.
type Db = PrismaClient | Prisma.TransactionClient;

export function emit(db: Db, intakeId: string, type: EventType, payload?: unknown) {
  return db.event.create({
    data: {
      intakeId,
      type,
      payload: payload === undefined ? null : JSON.stringify(payload),
    },
  });
}
