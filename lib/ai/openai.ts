import OpenAI from 'openai';
import { RetriableError } from '../queue/types';
import { cacheKey, readCache, writeCache } from './cache';
import type { AiConfig } from './config';
import { TRIAGE_JSON_SCHEMA, TriageOutputSchema } from './contract';
import { buildMessages, PROMPT_VERSION } from './prompt';
import type { ProviderResult, TriageProvider } from './types';

const RETRIABLE_STATUS = new Set([408, 409, 429]);

// Reads the summary out of a JSON body that is still being written, so the detail page has
// something to show before the model is done.
const PARTIAL_SUMMARY = /"summary"\s*:\s*"((?:[^"\\]|\\.)*)/;

function partialSummary(buffer: string) {
  const match = PARTIAL_SUMMARY.exec(buffer);
  if (!match) return undefined;

  try {
    return JSON.parse(`"${match[1].replace(/\\$/, '')}"`) as string;
  } catch {
    // Mid-escape, so wait for the next chunk.
    return undefined;
  }
}

function classify(err: unknown, shutdown: AbortSignal): unknown {
  if (err instanceof RetriableError) return err;
  // A shutdown aborts this same signal, and the worker's drain path owns that case.
  if (shutdown.aborted) return err;

  if (err instanceof OpenAI.APIError && typeof err.status === 'number') {
    return err.status >= 500 || RETRIABLE_STATUS.has(err.status)
      ? new RetriableError(`OpenAI returned ${err.status}.`, { cause: err })
      : new Error(`OpenAI rejected the request with ${err.status}: ${err.message}`);
  }

  const message = err instanceof Error ? err.message : String(err);
  return new RetriableError(`Could not reach OpenAI: ${message}`, { cause: err });
}

export function createOpenAiProvider(config: AiConfig): TriageProvider {
  // The worker owns retries and the backoff, so the SDK must not add a second schedule.
  const client = new OpenAI({ apiKey: config.apiKey, maxRetries: 0 });

  return async (intake, ctx) => {
    const key = cacheKey({ model: config.model, promptVersion: PROMPT_VERSION, intake });

    if (config.cache) {
      const hit = await readCache<ProviderResult>(key);
      if (hit) {
        ctx.onPartial(hit.output.summary);
        return { ...hit, latencyMs: 0, cached: true };
      }
    }

    const startedAt = Date.now();
    const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(config.timeoutMs)]);

    try {
      const stream = await client.chat.completions.create(
        {
          model: config.model,
          messages: buildMessages(intake),
          response_format: { type: 'json_schema', json_schema: TRIAGE_JSON_SCHEMA },
          stream: true,
          stream_options: { include_usage: true },
        },
        { signal },
      );

      let raw = '';
      let tokensIn: number | undefined;
      let tokensOut: number | undefined;

      for await (const chunk of stream) {
        raw += chunk.choices[0]?.delta?.content ?? '';
        if (chunk.usage) {
          tokensIn = chunk.usage.prompt_tokens;
          tokensOut = chunk.usage.completion_tokens;
        }

        const summary = partialSummary(raw);
        if (summary) ctx.onPartial(summary);
      }

      let output;
      try {
        output = TriageOutputSchema.parse(JSON.parse(raw));
      } catch (err) {
        throw new RetriableError('The model did not return the agreed JSON shape.', { cause: err });
      }

      const result: ProviderResult = {
        output,
        raw,
        model: config.model,
        latencyMs: Date.now() - startedAt,
        tokensIn,
        tokensOut,
      };

      if (config.cache) await writeCache(key, result);
      return result;
    } catch (err) {
      throw classify(err, ctx.signal);
    }
  };
}
