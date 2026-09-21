import OpenAI from 'openai';
import { RetriableError } from '../queue/types';
import { cacheKey, readCache, writeCache } from './cache';
import type { AiConfig } from './config';
import { TRIAGE_JSON_SCHEMA, TriageOutputSchema, type TriageOutput } from './contract';
import { buildMessages, PROMPT_VERSION } from './prompt';
import { UnprocessableIntakeError, type ProviderResult, type TriageProvider } from './types';

const RETRIABLE_STATUS = new Set([408, 409, 429]);
// Any other 400 means the request itself is wrong, and falling back would hide a bad
// OPENAI_MODEL behind degraded triages.
const UNPROCESSABLE_CODES = new Set([
  'context_length_exceeded',
  'string_above_max_length',
  'invalid_prompt',
  'content_policy_violation',
]);

const unprocessable = (err: InstanceType<typeof OpenAI.APIError>) =>
  err.status === 422 ||
  (err.status === 400 && typeof err.code === 'string' && UNPROCESSABLE_CODES.has(err.code));

// Reads the summary out of a JSON body that is still being written, so the detail page has
// something to show before the model is done.
const PARTIAL_SUMMARY = /"summary"\s*:\s*"((?:[^"\\]|\\.)*)/;

export function partialSummary(buffer: string) {
  const match = PARTIAL_SUMMARY.exec(buffer);
  if (!match) return undefined;

  try {
    return JSON.parse(`"${match[1].replace(/\\$/, '')}"`) as string;
  } catch {
    // Mid-escape, so wait for the next chunk.
    return undefined;
  }
}

export function parseTriageOutput(raw: string): TriageOutput {
  try {
    return TriageOutputSchema.parse(JSON.parse(raw));
  } catch (err) {
    throw new RetriableError('The model did not return the agreed JSON shape.', { cause: err });
  }
}

export function classify(err: unknown, shutdown: AbortSignal): unknown {
  if (err instanceof RetriableError) return err;
  // A shutdown aborts this same signal, and the worker's drain path owns that case.
  if (shutdown.aborted) return err;

  if (err instanceof OpenAI.APIError && typeof err.status === 'number') {
    if (err.status >= 500 || RETRIABLE_STATUS.has(err.status)) {
      return new RetriableError(`OpenAI returned ${err.status}.`, { cause: err });
    }
    if (unprocessable(err)) {
      return new UnprocessableIntakeError(
        `OpenAI would not process this intake (${err.status} ${err.code}): ${err.message}`,
        { cause: err },
      );
    }
    return new Error(`OpenAI rejected the request with ${err.status}: ${err.message}`);
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
      const output = TriageOutputSchema.safeParse(hit?.output);
      if (hit && output.success) {
        ctx.onPartial(output.data.summary);
        // Zeroed because this run spent nothing, and the uncached run recorded the real spend.
        return { ...hit, output: output.data, latencyMs: 0, tokensIn: 0, tokensOut: 0, cached: true };
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

      const result: ProviderResult = {
        output: parseTriageOutput(raw),
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
