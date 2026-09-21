'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const INTERVAL_MS = 3_000;

// Server components never re-render on their own, so without polling a finished row stays on
// "Analysing" until the Phase 5 event stream replaces this.
export function AutoRefresh({ enabled }: { enabled: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;

    const tick = () => {
      // A background tab is not watching, and every tick is a database round trip.
      if (document.visibilityState === 'visible') router.refresh();
    };

    const timer = setInterval(tick, INTERVAL_MS);
    document.addEventListener('visibilitychange', tick);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [enabled, router]);

  return null;
}
