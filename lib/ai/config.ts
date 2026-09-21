import { z } from 'zod';

export const AI_PROVIDERS = ['openai', 'mock'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

const truthy = new Set(['1', 'true', 'yes']);
const FAILURE_OFF = new Set(['', '0', 'false', 'no']);
const FAILURE_MODES = {
  '1': 'retriable',
  true: 'retriable',
  yes: 'retriable',
  retriable: 'retriable',
  unprocessable: 'unprocessable',
  terminal: 'terminal',
} as const;

const AiConfigSchema = z
  .object({
    AI_PROVIDER: z
      .enum(AI_PROVIDERS, {
        errorMap: () => ({ message: `AI_PROVIDER must be one of ${AI_PROVIDERS.join(', ')}.` }),
      })
      .default('openai'),
    OPENAI_API_KEY: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().trim().min(1).optional(),
    ),
    OPENAI_MODEL: z.string().trim().min(1).default('gpt-4o-mini'),
    AI_TIMEOUT_MS: z.coerce
      .number({ invalid_type_error: 'AI_TIMEOUT_MS must be a number.' })
      .int()
      .positive('AI_TIMEOUT_MS must be greater than zero.')
      .default(30_000),
    AI_CACHE: z.string().trim().optional(),
    FORCE_AI_FAILURE: z
      .string()
      .trim()
      .transform((v) => v.toLowerCase())
      .refine((v) => FAILURE_OFF.has(v) || Object.hasOwn(FAILURE_MODES, v), {
        message: `FORCE_AI_FAILURE must be one of ${Object.keys(FAILURE_MODES).join(', ')}, or unset.`,
      })
      .optional(),
    NODE_ENV: z.string().optional(),
  })
  .refine((c) => c.AI_PROVIDER !== 'openai' || c.OPENAI_API_KEY, {
    message: 'OPENAI_API_KEY is required unless AI_PROVIDER=mock.',
  });

export type AiConfig = {
  provider: AiProvider;
  apiKey?: string;
  model: string;
  timeoutMs: number;
  cache: boolean;
  forceFailure?: 'retriable' | 'unprocessable' | 'terminal';
};

export function loadAiConfig(env: Record<string, string | undefined> = process.env): AiConfig {
  const parsed = AiConfigSchema.safeParse(env);

  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.message}`).join('\n');
    throw new Error(`AI configuration is invalid:\n${problems}`);
  }

  const c = parsed.data;
  const forced = c.FORCE_AI_FAILURE ?? '';

  return {
    provider: c.AI_PROVIDER,
    apiKey: c.OPENAI_API_KEY,
    model: c.AI_PROVIDER === 'mock' ? 'mock' : c.OPENAI_MODEL,
    timeoutMs: c.AI_TIMEOUT_MS,
    // Only where NODE_ENV says so: anywhere else, caching client intakes to disk needs
    // AI_CACHE set on purpose.
    cache: c.AI_CACHE
      ? truthy.has(c.AI_CACHE.toLowerCase())
      : c.NODE_ENV === 'development' || c.NODE_ENV === 'test',
    forceFailure: FAILURE_OFF.has(forced)
      ? undefined
      : FAILURE_MODES[forced as keyof typeof FAILURE_MODES],
  };
}
