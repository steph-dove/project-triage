'use client';

import { useEffect, useRef, useState } from 'react';
import { HEARTBEAT_MS, parseFrame, type StreamEvent } from '@/lib/stream';

// Three short-lived connections in a row is a stream that is not coming back on its own: a
// restarted server, a proxy that will not hold it open, a route that opens and then dies.
const MAX_DROPS = 3;

// Long enough that a degraded page is not hammering a server that is already unhappy, short
// enough that it picks the stream back up on its own after a deploy.
const REOPEN_AFTER_MS = 30_000;

export type StreamHealth = 'connecting' | 'open' | 'degraded';

type Options = {
  enabled: boolean;
  // Absent means every intake, which is what the list page wants.
  intakeId?: string;
  // Where the page was rendered, so nothing that happened before the socket opened is lost.
  sinceSeq?: number;
  onEvent: (event: StreamEvent) => void;
};

export function useEventStream({ enabled, intakeId, sinceSeq, onEvent }: Options): StreamHealth {
  const [health, setHealth] = useState<StreamHealth>('connecting');
  // Degraded has to be recoverable. Bumping this re-runs the effect, so a page that lost the
  // stream during a deploy picks it up again instead of polling until the tab is closed.
  const [attempt, setAttempt] = useState(0);

  // Through a ref so a caller that builds its handler inline does not reopen the stream on
  // every render.
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  });

  useEffect(() => {
    if (!enabled) return;

    if (typeof EventSource === 'undefined') {
      setHealth('degraded');
      return;
    }

    const query = new URLSearchParams();
    if (intakeId) query.set('intakeId', intakeId);
    if (sinceSeq !== undefined) query.set('sinceSeq', String(sinceSeq));
    const source = new EventSource(`/api/stream?${query}`);

    let drops = 0;
    let openedAt = 0;
    let reopen: NodeJS.Timeout | undefined;

    source.onopen = () => {
      openedAt = Date.now();
      setHealth('open');
    };

    source.onmessage = (message: MessageEvent<string>) => {
      const event = parseFrame(message.data);
      if (event) handler.current(event);
    };

    source.onerror = () => {
      // A non-200 or the wrong content type fails the connection for good: the browser sets
      // CLOSED, fires this once and never retries. Counting drops would wait for a second
      // error that is not coming.
      if (source.readyState === EventSource.CLOSED) {
        giveUp();
        return;
      }

      // The route answers 200 before finding the database unreadable, so only a connection that
      // outlived a heartbeat resets the count; zeroing in onopen would never reach the threshold.
      const worked = openedAt > 0 && Date.now() - openedAt > HEARTBEAT_MS;
      drops = worked ? 1 : drops + 1;
      openedAt = 0;

      if (drops < MAX_DROPS) {
        setHealth('connecting');
        return;
      }

      // EventSource would go on reconnecting forever. Handing over to polling is the honest
      // move, and the timer below brings the stream back when whatever broke is fixed.
      giveUp();
    };

    function giveUp() {
      source.close();
      setHealth('degraded');
      reopen = setTimeout(() => setAttempt((n) => n + 1), REOPEN_AFTER_MS);
    }

    return () => {
      source.close();
      clearTimeout(reopen);
    };
  }, [enabled, intakeId, sinceSeq, attempt]);

  return health;
}
