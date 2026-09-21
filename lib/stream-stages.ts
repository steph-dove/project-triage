import type { StreamEvent } from './stream';

// The wireframe's stages; the event log has more types because it is also an audit trail.
export const STAGES = ['QUEUED', 'ANALYSING', 'VALIDATING', 'READY'] as const;

export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  QUEUED: 'Queued',
  ANALYSING: 'Analysing',
  VALIDATING: 'Validating',
  READY: 'Ready',
};

export type StageTiming = { enteredAt: number; leftAt?: number };

export type StreamState = {
  stages: Partial<Record<Stage, StageTiming>>;
  current: Stage;
  outcome: 'running' | 'ready' | 'failed';
  // The latest PARTIAL, which carries the summary so far rather than a delta.
  summary?: string;
  error?: string;
};

export const INITIAL_STREAM_STATE: StreamState = {
  stages: {},
  current: 'QUEUED',
  outcome: 'running',
};

export function reduceStream(state: StreamState, event: StreamEvent): StreamState {
  const at = timestamp(event.createdAt);

  switch (event.type) {
    case 'QUEUED':
      return { ...INITIAL_STREAM_STATE, stages: { QUEUED: { enteredAt: at } } };

    case 'CLAIMED':
      return {
        ...state,
        current: 'ANALYSING',
        stages: { ...close(state.stages, 'QUEUED', at), ANALYSING: { enteredAt: at } },
      };

    // A stream that resumed mid-call never saw the CLAIMED that normally opens this stage.
    case 'CALLING_MODEL':
      return state.stages.ANALYSING
        ? state
        : {
            ...state,
            current: 'ANALYSING',
            stages: { ...close(state.stages, 'QUEUED', at), ANALYSING: { enteredAt: at } },
          };

    case 'PARTIAL':
      return { ...state, summary: field(event.payload, 'summary') ?? state.summary };

    case 'VALIDATING':
      return {
        ...state,
        current: 'VALIDATING',
        stages: { ...close(state.stages, 'ANALYSING', at), VALIDATING: { enteredAt: at } },
      };

    // A fallback still finished, just with a heuristic.
    case 'READY':
    case 'FALLBACK':
      return {
        ...state,
        current: 'READY',
        outcome: 'ready',
        stages: { ...close(state.stages, 'VALIDATING', at), READY: { enteredAt: at, leftAt: at } },
      };

    case 'FAILED':
      return {
        ...state,
        outcome: 'failed',
        error: field(event.payload, 'error'),
        stages: close(state.stages, state.current, at),
      };

    // Back to Queued for the next attempt, keeping the error that explains why.
    case 'RETRY_SCHEDULED':
      return {
        ...INITIAL_STREAM_STATE,
        stages: { QUEUED: { enteredAt: at } },
        error: field(event.payload, 'error'),
      };

    default:
      return state;
  }
}

// Undefined for a stage that has not started, so the stepper can tell "not reached" from
// "took no measurable time".
export function elapsedMs(timing: StageTiming | undefined, now: number): number | undefined {
  if (!timing) return undefined;
  return (timing.leftAt ?? now) - timing.enteredAt;
}

function close(
  stages: StreamState['stages'],
  stage: Stage,
  at: number,
): StreamState['stages'] {
  const timing = stages[stage];
  return timing ? { ...stages, [stage]: { ...timing, leftAt: at } } : stages;
}

// Payloads come off the wire as unknown, and an older row may not carry the key at all.
function field(payload: unknown, key: string): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

// A row with an unreadable timestamp would otherwise make every elapsed time NaN.
function timestamp(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}
