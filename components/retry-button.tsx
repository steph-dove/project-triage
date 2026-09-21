'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { networkMessage, REQUEST_TIMEOUT_MS } from '@/lib/network';

const TONES = {
  fallback: 'border-amber-ink text-amber-ink',
  failed: 'border-clay-ink text-clay-ink',
} as const;

export function RetryButton({
  intakeId,
  tone,
}: {
  intakeId: string;
  tone: keyof typeof TONES;
}) {
  const router = useRouter();
  const [queueing, setQueueing] = useState(false);
  const [error, setError] = useState<string>();

  const retry = async () => {
    setQueueing(true);
    setError(undefined);

    try {
      const response = await fetch(`/api/intakes/${intakeId}/enrich`, {
        method: 'POST',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? `The server would not queue it (${response.status}).`);
        setQueueing(false);
        return;
      }

      // Left disabled: the refresh replaces this whole banner with the stepper, so the only
      // thing re-enabling buys is a second click on work that is already queued.
      router.refresh();
    } catch (err) {
      console.error('[retry] could not queue the analysis', err);
      setError(networkMessage(err));
      setQueueing(false);
    }
  };

  return (
    <div className="shrink-0">
      <button
        type="button"
        onClick={retry}
        disabled={queueing}
        className={`rounded-md border bg-card px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-50 ${TONES[tone]}`}
      >
        {queueing ? 'Queueing…' : 'Retry analysis'}
      </button>
      {error && (
        <p role="alert" className="mt-2 max-w-48 text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
