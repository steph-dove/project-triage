'use client';

import { useEffect, useRef, useState } from 'react';
import { parseFrame, type StreamEvent } from '@/lib/stream';

// Three failed connections in a row is a stream that is not coming back on its own: a restarted
// server, a proxy that will not hold it open, a browser out of connections to this origin.
const MAX_DROPS = 3;

export type StreamHealth = 'connecting' | 'open' | 'degraded';

type Options = {
  enabled: boolean;
  // Absent means every intake, which is what the list page wants.
  intakeId?: string;
  onEvent: (event: StreamEvent) => void;
};

export function useEventStream({ enabled, intakeId, onEvent }: Options): StreamHealth {
  const [health, setHealth] = useState<StreamHealth>('connecting');

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

    const url = intakeId ? `/api/stream?intakeId=${encodeURIComponent(intakeId)}` : '/api/stream';
    const source = new EventSource(url);
    let drops = 0;

    source.onopen = () => {
      drops = 0;
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
        setHealth('degraded');
        return;
      }

      drops += 1;
      if (drops < MAX_DROPS) {
        setHealth('connecting');
        return;
      }

      // EventSource would reconnect forever, so hand over to polling instead.
      source.close();
      setHealth('degraded');
    };

    return () => source.close();
  }, [enabled, intakeId]);

  return health;
}
