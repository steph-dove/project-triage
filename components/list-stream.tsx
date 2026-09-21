'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';
import { useEventStream } from '@/hooks/use-event-stream';
import type { EventType } from '@/lib/events';
import { AutoRefresh } from './auto-refresh';

// Only events that change a card; PARTIAL, CALLING_MODEL and VALIDATING happen inside
// "Analysing", and refreshing for them would be a query per token.
const REDRAWS_A_CARD = new Set<EventType>([
  'QUEUED',
  'CLAIMED',
  'READY',
  'FALLBACK',
  'FAILED',
  'RETRY_SCHEDULED',
  'STATUS_CHANGED',
]);

// Ten rows finishing together should cost one render, not ten.
const SETTLE_MS = 250;

// One stream for the whole page, opened only while something on it is unfinished.
export function ListStream({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const timer = useRef<NodeJS.Timeout>(undefined);

  const onEvent = useCallback(
    (event: { type: EventType }) => {
      if (!REDRAWS_A_CARD.has(event.type)) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), SETTLE_MS);
    },
    [router],
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  const health = useEventStream({ enabled, onEvent });

  // T5.6: polling is worse, but it is the difference between degraded and broken.
  return <AutoRefresh enabled={enabled && health === 'degraded'} />;
}
