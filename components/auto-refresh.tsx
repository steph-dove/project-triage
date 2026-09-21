'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const INTERVAL_MS = 3_000;
const GIVE_UP_AFTER_MS = 5 * 60_000;

// Polling fallback for when the event stream will not stay up, since server components never
// re-render on their own.
export function AutoRefresh({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!enabled) return;

    const startedAt = Date.now();

    const tick = () => {
      // Five minutes of no progress means the worker is probably not running, and a tab left
      // open overnight should not keep three SQLite queries going every 3s.
      if (Date.now() - startedAt > GIVE_UP_AFTER_MS) {
        clearInterval(timer);
        setGaveUp(true);
        return;
      }
      // A background tab is not being watched, so there is nothing to refresh for.
      if (document.visibilityState === 'visible') router.refresh();
    };

    // tick only reads timer once the interval has fired, so it is assigned by then.
    const timer = setInterval(tick, INTERVAL_MS);
    document.addEventListener('visibilitychange', tick);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [enabled, round, router]);

  // Giving up quietly would leave the page looking the same as one still making progress.
  if (!enabled || !gaveUp) return null;

  return (
    <p className="rounded-md bg-stone px-4 py-3 text-sm text-stone-ink">
      This has been waiting a while, so it stopped checking. Nothing is lost, the analysis runs
      whenever a worker picks it up.{' '}
      <button
        type="button"
        onClick={() => {
          setGaveUp(false);
          setRound((n) => n + 1);
          router.refresh();
        }}
        className="font-semibold underline underline-offset-2"
      >
        Check again
      </button>
    </p>
  );
}
