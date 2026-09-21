import type { AiConfig } from '../../ai/config';
import { heuristicTriage } from '../../ai/fallback';
import { applyGuardrails } from '../../ai/guardrails';
import { PROMPT_VERSION } from '../../ai/prompt';
import { createProvider } from '../../ai/provider';
import { UnprocessableIntakeError } from '../../ai/types';
import { RetriableError, type EnrichmentResult, type Processor } from '../types';

const PARTIAL_INTERVAL_MS = 300;

const forcedFailure = (mode: NonNullable<AiConfig['forceFailure']>) => {
  const message = `FORCE_AI_FAILURE=${mode}, so the model was never called.`;
  if (mode === 'terminal') return new Error(message);
  if (mode === 'unprocessable') return new UnprocessableIntakeError(message);
  return new RetriableError(message);
};

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
      const spent = err instanceof RetriableError && job.attempts >= maxAttempts;
      const unprocessable = err instanceof UnprocessableIntakeError;
      if (ctx.signal.aborted || !(spent || unprocessable)) throw err;

      // A heuristic triage beats an empty detail page once the model is out of chances.
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
