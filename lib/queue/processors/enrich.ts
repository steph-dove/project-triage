import type { AiConfig } from '../../ai/config';
import { heuristicTriage } from '../../ai/fallback';
import { applyGuardrails } from '../../ai/guardrails';
import { PROMPT_VERSION } from '../../ai/prompt';
import { createProvider } from '../../ai/provider';
import { RetriableError, type EnrichmentResult, type Processor } from '../types';

const PARTIAL_INTERVAL_MS = 300;

const forcedFailure = (mode: NonNullable<AiConfig['forceFailure']>) =>
  mode === 'terminal'
    ? new Error('FORCE_AI_FAILURE=terminal, so the model was never called.')
    : new RetriableError('FORCE_AI_FAILURE is set, so the model was never called.');

export function createEnrichmentProcessor(config: AiConfig, maxAttempts: number): Processor {
  const provider = createProvider(config);

  return async (job, ctx) => {
    await ctx.emit('CALLING_MODEL', { provider: config.provider, model: config.model });

    let lastPartialAt = 0;
    const onPartial = (summary: string) => {
      if (Date.now() - lastPartialAt < PARTIAL_INTERVAL_MS) return;
      lastPartialAt = Date.now();
      void ctx.emit('PARTIAL', { summary }).catch((err) => {
        console.error(`[ai] could not record a PARTIAL event for ${job.intakeId}`, err);
      });
    };

    try {
      if (config.forceFailure) throw forcedFailure(config.forceFailure);

      const result = await provider(job.intake, { signal: ctx.signal, onPartial });
      await ctx.emit('VALIDATING', { cached: result.cached === true });

      return {
        ...applyGuardrails(result.output, [job.intake.industry, 'needs-review', 'triage']),
        source: 'LLM',
        model: result.model,
        promptVersion: PROMPT_VERSION,
        rawResponse: result.raw,
        latencyMs: result.latencyMs,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
      } satisfies EnrichmentResult;
    } catch (err) {
      const retriable = err instanceof RetriableError;
      if (ctx.signal.aborted || !retriable || job.attempts < maxAttempts) throw err;

      // Out of retries on a reachable failure: a heuristic triage beats an empty detail page.
      console.warn(`[ai] falling back to the heuristic for ${job.intakeId}: ${err.message}`);
      return {
        ...heuristicTriage(job.intake),
        source: 'FALLBACK',
        promptVersion: PROMPT_VERSION,
        rawResponse: JSON.stringify({ fallbackReason: err.message }),
      } satisfies EnrichmentResult;
    }
  };
}
