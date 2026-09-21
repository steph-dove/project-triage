import { describe, expect, it } from 'vitest';
import type { EventType } from '../../lib/events';
import type { StreamEvent } from '../../lib/stream';
import {
  elapsedMs,
  INITIAL_STREAM_STATE,
  reduceStream,
  type StreamState,
} from '../../lib/stream-stages';

const T0 = Date.parse('2026-09-20T12:00:00.000Z');

const at = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

const event = (type: EventType, offsetMs: number, payload: unknown = null): StreamEvent => ({
  seq: offsetMs,
  intakeId: 'intake-1',
  type,
  payload,
  createdAt: at(offsetMs),
});

const run = (events: StreamEvent[]): StreamState =>
  events.reduce(reduceStream, INITIAL_STREAM_STATE);

describe('reduceStream', () => {
  it('walks a whole analysis from queued to ready and times each stage', () => {
    const state = run([
      event('QUEUED', 0),
      event('CLAIMED', 200),
      event('CALLING_MODEL', 210),
      event('PARTIAL', 900, { summary: 'A six-week pilot' }),
      event('VALIDATING', 3_100),
      event('READY', 3_300, { source: 'LLM' }),
    ]);

    expect(state.outcome).toBe('ready');
    expect(state.current).toBe('READY');
    expect(state.summary).toBe('A six-week pilot');
    expect(elapsedMs(state.stages.QUEUED, Date.now())).toBe(200);
    expect(elapsedMs(state.stages.ANALYSING, Date.now())).toBe(2_900);
    expect(elapsedMs(state.stages.VALIDATING, Date.now())).toBe(200);
  });

  it('treats a fallback as finished, because it is', () => {
    const state = run([event('QUEUED', 0), event('CLAIMED', 100), event('FALLBACK', 500)]);

    expect(state.outcome).toBe('ready');
    expect(state.current).toBe('READY');
  });

  it('stops on the stage that failed rather than leaving it running', () => {
    const state = run([
      event('QUEUED', 0),
      event('CLAIMED', 100),
      event('CALLING_MODEL', 110),
      event('FAILED', 2_000, { error: 'invalid API credentials' }),
    ]);

    expect(state.outcome).toBe('failed');
    expect(state.current).toBe('ANALYSING');
    expect(state.error).toBe('invalid API credentials');
    // Closed, so the stepper shows a number instead of counting up forever.
    expect(state.stages.ANALYSING?.leftAt).toBe(T0 + 2_000);
  });

  it('goes back to queued when another attempt is scheduled, and says why', () => {
    const state = run([
      event('QUEUED', 0),
      event('CLAIMED', 100),
      event('VALIDATING', 800),
      event('RETRY_SCHEDULED', 900, { error: 'OpenAI returned 503.' }),
    ]);

    expect(state.current).toBe('QUEUED');
    expect(state.outcome).toBe('running');
    expect(state.error).toBe('OpenAI returned 503.');
    expect(state.stages.VALIDATING).toBeUndefined();
  });

  it('opens the analysing stage for a stream that resumed after CLAIMED went past', () => {
    const state = run([event('CALLING_MODEL', 400)]);

    expect(state.current).toBe('ANALYSING');
    expect(state.stages.ANALYSING?.enteredAt).toBe(T0 + 400);
  });

  it('keeps the last summary when a later event carries no payload', () => {
    const state = run([
      event('PARTIAL', 100, { summary: 'half a sentence' }),
      event('PARTIAL', 200, {}),
    ]);

    expect(state.summary).toBe('half a sentence');
  });

  it('ignores events that say nothing about progress', () => {
    const before = run([event('QUEUED', 0), event('CLAIMED', 100)]);
    const after = reduceStream(before, event('STATUS_CHANGED', 200, { to: 'ACCEPTED' }));

    expect(after).toBe(before);
  });

  it('falls back to the clock rather than producing NaN timings', () => {
    const state = reduceStream(INITIAL_STREAM_STATE, {
      seq: 1,
      intakeId: 'intake-1',
      type: 'QUEUED',
      payload: null,
      createdAt: 'not a date',
    });

    expect(Number.isNaN(state.stages.QUEUED?.enteredAt)).toBe(false);
  });
});

describe('elapsedMs', () => {
  it('has nothing to report for a stage that was never reached', () => {
    expect(elapsedMs(undefined, Date.now())).toBeUndefined();
  });

  it('counts an open stage up to now', () => {
    expect(elapsedMs({ enteredAt: T0 }, T0 + 1_500)).toBe(1_500);
  });
});
