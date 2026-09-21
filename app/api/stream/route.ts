import { db } from '@/lib/db';
import { tailEvents } from '@/lib/queue/sqlite-store';
import { resolveCursor } from '@/lib/stream-cursor';
import { encodeFrame, HEARTBEAT_MS, type StreamEvent } from '@/lib/stream';

// Prisma and the tail's timers both need Node, and a cached stream is not a stream.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TAIL_FAILURES = 5;

export async function GET(request: Request) {
  const intakeId = new URL(request.url).searchParams.get('intakeId') ?? undefined;
  const sinceSeq = await resolveCursor(request, intakeId);

  const encoder = new TextEncoder();
  let subscription: { stop: () => void } | undefined;
  let heartbeat: NodeJS.Timeout | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      // Enqueueing onto a controller whose client has gone throws, and the abort listener and
      // the tail can both get there first.
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        subscription?.stop();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Already closed by the runtime when the client hung up.
        }
      };

      // A comment frame: it keeps the connection warm without reaching onmessage.
      heartbeat = setInterval(() => send(':\n\n'), HEARTBEAT_MS);

      subscription = tailEvents(
        db,
        { sinceSeq, intakeId },
        {
          onEvent: (event) => send(encodeFrame(toStreamEvent(event))),
          onError: (_err, consecutiveFailures) => {
            // Closing hands the browser its own reconnect, which restarts the tail with a
            // fresh client rather than leaving the page attached to a dead one.
            if (consecutiveFailures >= MAX_TAIL_FAILURES) close();
          },
        },
      );

      request.signal.addEventListener('abort', close, { once: true });
      if (request.signal.aborted) close();
    },

    cancel() {
      subscription?.stop();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // nginx buffers proxied responses by default, which holds every frame back.
      'X-Accel-Buffering': 'no',
    },
  });
}

function toStreamEvent(row: {
  seq: number;
  intakeId: string;
  type: string;
  payload: string | null;
  createdAt: Date;
}): StreamEvent {
  return {
    seq: row.seq,
    intakeId: row.intakeId,
    type: row.type as StreamEvent['type'],
    payload: parsePayload(row.payload),
    createdAt: row.createdAt.toISOString(),
  };
}

function parsePayload(raw: string | null): unknown {
  if (raw === null) return null;

  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error('[stream] could not parse an event payload, sending null:', raw, err);
    return null;
  }
}
