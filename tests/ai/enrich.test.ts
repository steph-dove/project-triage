import { describe, expect, it } from 'vitest';
import { loadAiConfig } from '../../lib/ai/config';
import { PROMPT_VERSION } from '../../lib/ai/prompt';
import { createEnrichmentProcessor } from '../../lib/queue/processors/enrich';
import type { EventType } from '../../lib/events';
import { RetriableError, type ClaimedJob } from '../../lib/queue/types';

const MAX_ATTEMPTS = 3;

const job = (attempts = 1): ClaimedJob => ({
  enrichmentId: 'e1',
  intakeId: 'i1',
  attempts,
  lockToken: 't1',
  intake: {
    title: 'Forecasting for a regional carrier',
    description:
      'We want to forecast freight demand across twenty depots. The current spreadsheet model is maintained by one analyst and nobody else understands it.',
    budgetRange: '$50k-100k',
    timeline: '6 weeks',
    industry: 'Logistics',
  },
});

const context = () => {
  const events: EventType[] = [];
  return {
    events,
    ctx: {
      emit: async (type: EventType) => {
        events.push(type);
      },
      signal: new AbortController().signal,
    },
  };
};

const processor = (env: Record<string, string> = {}) =>
  createEnrichmentProcessor(loadAiConfig({ AI_PROVIDER: 'mock', ...env }), MAX_ATTEMPTS);

describe('the enrichment processor', () => {
  it('returns a guarded result and the events that got it there', async () => {
    const { ctx, events } = context();

    const result = await processor()(job(), ctx);

    expect(result.source).toBe('LLM');
    expect(result.tags).toHaveLength(3);
    expect(result.promptVersion).toBe(PROMPT_VERSION);
    expect(result.summary.length).toBeGreaterThan(0);
    expect(events).toContain('CALLING_MODEL');
    expect(events).toContain('PARTIAL');
    expect(events).toContain('VALIDATING');
  });

  it('retries a forced failure while it still has attempts', async () => {
    const { ctx } = context();

    await expect(processor({ FORCE_AI_FAILURE: '1' })(job(1), ctx)).rejects.toBeInstanceOf(
      RetriableError,
    );
  });

  it('falls back to the heuristic on the last attempt', async () => {
    const { ctx } = context();

    const result = await processor({ FORCE_AI_FAILURE: '1' })(job(MAX_ATTEMPTS), ctx);

    expect(result.source).toBe('FALLBACK');
    expect(result.tags).toHaveLength(3);
    expect(result.rawResponse).toContain('fallbackReason');
  });

  it('falls back on the first attempt when the model rejects the intake itself', async () => {
    const { ctx } = context();

    const result = await processor({ FORCE_AI_FAILURE: 'unprocessable' })(job(1), ctx);

    expect(result.source).toBe('FALLBACK');
    expect(result.rawResponse).toContain('fallbackReason');
  });

  it('never falls back on a terminal failure, however many attempts are left', async () => {
    const { ctx } = context();

    const failure = processor({ FORCE_AI_FAILURE: 'terminal' })(job(MAX_ATTEMPTS), ctx);

    await expect(failure).rejects.toThrow(/FORCE_AI_FAILURE=terminal/);
    await expect(failure).rejects.not.toBeInstanceOf(RetriableError);
  });
});
