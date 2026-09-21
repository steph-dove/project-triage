'use client';

import { useCallback, useEffect, useReducer } from 'react';
import type { StreamEvent } from '@/lib/stream';
import { INITIAL_STREAM_STATE, reduceStream, type StreamState } from '@/lib/stream-stages';
import { useEventStream, type StreamHealth } from './use-event-stream';

type Action = { kind: 'event'; event: StreamEvent } | { kind: 'reset' };

function reduce(state: StreamState, action: Action): StreamState {
  return action.kind === 'reset' ? INITIAL_STREAM_STATE : reduceStream(state, action.event);
}

/**
 * Live stage, timings, summary and outcome for one intake's analysis.
 *
 * The stream closes once the analysis settles, since an open one costs a database poll;
 * `enabled` comes from server state, so a retry reopens it.
 */
export function useIntakeStream({ intakeId, enabled }: { intakeId: string; enabled: boolean }): {
  state: StreamState;
  health: StreamHealth;
} {
  const [state, dispatch] = useReducer(reduce, INITIAL_STREAM_STATE);

  // A retry reuses this component, and last run's stages would otherwise still be on screen.
  useEffect(() => {
    dispatch({ kind: 'reset' });
  }, [intakeId, enabled]);

  const onEvent = useCallback((event: StreamEvent) => dispatch({ kind: 'event', event }), []);

  const health = useEventStream({
    enabled: enabled && state.outcome === 'running',
    intakeId,
    onEvent,
  });

  return { state, health };
}
