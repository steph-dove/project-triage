'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';
import { useEventStream } from '@/hooks/use-event-stream';
import { AutoRefresh } from './auto-refresh';

// Ten rows finishing together should cost one render, not ten.
const SETTLE_MS = 250;

/**
 * One stream for the whole page, open only while something on it is unfinished.
 *
 * `sinceSeq` is where the server rendered. Without it the stream would start at the tip when
 * the connection opens, which is a hydration later, and anything that finished in between
 * would never be heard about.
 */
export function ListStream({ enabled, sinceSeq }: { enabled: boolean; sinceSeq: number }) {
  const router = useRouter();
  const timer = useRef<NodeJS.Timeout>(undefined);

  const onEvent = useCallback(() => {
    // Throttle, not debounce: a busy queue emits faster than the settle window, and clearing
    // the timer each time would push the refresh back for as long as the backlog lasts.
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      router.refresh();
    }, SETTLE_MS);
  }, [router]);

  useEffect(() => () => clearTimeout(timer.current), []);

  // The route only sends this stream the events that change a card, so every frame counts.
  const health = useEventStream({ enabled, sinceSeq, onEvent });

  // Polling is worse, but it is the difference between degraded and broken.
  return <AutoRefresh enabled={enabled && health === 'degraded'} />;
}
