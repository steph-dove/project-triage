'use client';

import { useEffect, useState } from 'react';
import { elapsedMs, STAGE_LABELS, STAGES, type Stage, type StreamState } from '@/lib/stream-stages';

const TICK_MS = 100;

type NodeState = 'done' | 'running' | 'failed' | 'waiting';

export function StageStepper({ state }: { state: StreamState }) {
  // Only while something is moving: a settled stepper has fixed numbers, and a tab left open
  // should not re-render ten times a second forever.
  const now = useNow(state.outcome === 'running');
  const total = totalMs(state, now);
  const failed = state.outcome === 'failed';

  return (
    <>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-mono text-xs tracking-widest text-faint uppercase">Triage analysis</h2>
        {total !== undefined && (
          <span className={`font-mono text-xs ${failed ? 'text-clay-ink' : 'text-rust'}`}>
            {seconds(total)} {failed ? 'before it failed' : 'elapsed'}
          </span>
        )}
      </div>

      {/* The ticking number would be unbearable read aloud, so the announcement is the stage. */}
      <p className="sr-only" aria-live="polite">
        {announcement(state)}
      </p>

      <ol className="mt-5 flex items-start border-b border-line pb-5">
        {STAGES.map((stage, index) => (
          <li key={stage} className={`flex items-start ${index > 0 ? 'flex-1' : ''}`}>
            {index > 0 && (
              <span
                aria-hidden
                className={`mt-3 h-px min-w-6 flex-1 ${
                  nodeState(state, STAGES[index - 1]) === 'done' ? 'bg-ink' : 'bg-line'
                }`}
              />
            )}
            <StageNode state={state} stage={stage} now={now} />
          </li>
        ))}
      </ol>
    </>
  );
}

const NODE_STYLES: Record<NodeState, string> = {
  done: 'border-ink bg-ink text-card',
  running: 'border-rust bg-rust text-card',
  failed: 'border-clay-ink bg-clay-ink text-card',
  waiting: 'border-line bg-card',
};

const LABEL_STYLES: Record<NodeState, string> = {
  done: 'text-ink',
  running: 'font-semibold text-rust',
  failed: 'font-semibold text-clay-ink',
  waiting: 'text-faint',
};

function StageNode({ state, stage, now }: { state: StreamState; stage: Stage; now: number }) {
  const status = nodeState(state, stage);
  const elapsed = elapsedMs(state.stages[stage], now);

  return (
    <div className="flex w-20 shrink-0 flex-col items-center gap-1.5 text-center">
      <span
        aria-hidden
        className={`flex size-6 items-center justify-center rounded-full border text-xs ${NODE_STYLES[status]}`}
      >
        {status === 'done' && '✓'}
        {status === 'failed' && '!'}
      </span>
      <span className={`text-sm ${LABEL_STYLES[status]}`}>{STAGE_LABELS[stage]}</span>

      {status === 'running' && <span className="font-mono text-xs text-rust">running</span>}
      {status === 'failed' && <span className="font-mono text-xs text-clay-ink">failed</span>}
      {status === 'done' && elapsed !== undefined && (
        <span className="font-mono text-xs text-faint">{seconds(elapsed)}</span>
      )}
    </div>
  );
}

// A stepper that cannot fail is a lie, so a failure stops the run on the stage it happened on
// rather than leaving that stage spinning.
function nodeState(state: StreamState, stage: Stage): NodeState {
  if (STAGES.indexOf(stage) > STAGES.indexOf(state.current)) return 'waiting';

  if (stage === state.current) {
    if (state.outcome === 'failed') return 'failed';
    return state.stages[stage]?.leftAt === undefined ? 'running' : 'done';
  }

  return 'done';
}

function totalMs(state: StreamState, now: number): number | undefined {
  const startedAt = state.stages.QUEUED?.enteredAt;
  if (startedAt === undefined) return undefined;

  const endedAt = state.outcome === 'running' ? now : (lastTimestamp(state) ?? now);
  return endedAt - startedAt;
}

function lastTimestamp(state: StreamState): number | undefined {
  const times = STAGES.flatMap((stage) => {
    const timing = state.stages[stage];
    return timing ? [timing.leftAt ?? timing.enteredAt] : [];
  });
  return times.length > 0 ? Math.max(...times) : undefined;
}

function announcement(state: StreamState): string {
  if (state.outcome === 'failed') return 'Analysis failed.';
  if (state.outcome === 'ready') return 'Analysis ready.';
  return `${STAGE_LABELS[state.current]}.`;
}

const seconds = (ms: number) => `${(Math.max(ms, 0) / 1000).toFixed(1)}s`;

function useNow(running: boolean) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [running]);

  return now;
}
