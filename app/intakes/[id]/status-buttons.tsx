'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { TRIAGE_STATUSES, type TriageStatus } from '@/lib/schemas';

// The buttons read as actions, not as labels: "Accept", not "Accepted".
const ACTION_LABELS: Record<TriageStatus, string> = {
  NEW: 'New',
  IN_REVIEW: 'In review',
  ACCEPTED: 'Accept',
  DECLINED: 'Decline',
};

export function StatusButtons({ id, status }: { id: string; status: TriageStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const busy = saving || pending;

  const change = async (next: TriageStatus) => {
    if (next === status || busy) return;

    setSaving(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/intakes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? `Could not save the status (${response.status}).`);
        return;
      }

      startTransition(() => router.refresh());
    } catch (err) {
      console.error(`[detail] could not set ${id} to ${next}`, err);
      setError('Could not reach the server. The status is unchanged.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2">
        {TRIAGE_STATUSES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => void change(option)}
            disabled={busy}
            aria-pressed={option === status}
            className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${
              option === status
                ? 'border-ink bg-ink text-card'
                : 'border-line bg-card hover:border-faint'
            }`}
          >
            {ACTION_LABELS[option]}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-clay-ink">
          {error}
        </p>
      )}
    </div>
  );
}
