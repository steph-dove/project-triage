import { db } from '@/lib/db';
import { tailEvents } from '@/lib/queue/sqlite-store';
import { resolveCursor } from '@/lib/stream-cursor';
import {
  encodeFrame,
  HEARTBEAT_MS,
  LIST_EVENTS,
  projectPayload,
  type StreamEvent,
} from '@/lib/stream';

// Prisma and the tail's timers both need Node, and a cached stream is not a stream.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TAIL_FAILURES = 5;

// Each stream runs its own 250ms tail; browsers cap at six per origin, so this only bounds abuse.
const MAX_OPEN_STREAMS = 64;

let openStreams = 0;

export async function GET(request: Request) {
  // Claimed before the first await: a check and increment either side of one would let requests
  // arriving during the cursor query pass a gate that is already full.
  if (openStreams >= MAX_OPEN_STREAMS) {
    return new Response('Too many open streams.', {
      status: 503,
      headers: { 'Retry-After': '5' },
    });
  }
  openStreams += 1;

  try {
    return await openStream(request);
  } catch (err) {
    // Only reached if the stream was never handed back, so close() will not run to release it.
    openStreams -= 1;
    throw err;
  }
}

async function openStream(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const intakeId = params.get('intakeId') ?? undefined;
  const sinceSeq = await resolveCursor(request, { intakeId, sinceSeq: params.get('sinceSeq') });

  // The list page is the only caller that leaves intakeId off, and it redraws on state changes.
  // Filtering at the query means a PARTIAL per token per in-flight job is never sent to it.
  const types = intakeId ? undefined : LIST_EVENTS;

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
        openStreams -= 1;
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
        { sinceSeq, intakeId, types },
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
  const type = row.type as StreamEvent['type'];

  return {
    seq: row.seq,
    intakeId: row.intakeId,
    type,
    payload: projectPayload(type, parsePayload(row.payload)),
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
