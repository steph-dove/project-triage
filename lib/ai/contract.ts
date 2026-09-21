import { z } from 'zod';

export const TriageOutputSchema = z.object({
  summary: z.string().min(1),
  tags: z.array(z.string()),
  risks: z.array(z.string()),
});

export type TriageOutput = z.infer<typeof TriageOutputSchema>;

// strict mode rejects minItems/maxItems, so the counts are enforced in guardrails instead.
export const TRIAGE_JSON_SCHEMA = {
  name: 'triage',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'tags', 'risks'],
    properties: {
      summary: {
        type: 'string',
        description: 'Two or three sentences a delivery lead can skim before the first call.',
      },
      tags: {
        type: 'array',
        description: 'Exactly three short lowercase labels, hyphens between words.',
        items: { type: 'string' },
      },
      risks: {
        type: 'array',
        description: 'Up to five concrete risks. Empty when the request is clean.',
        items: { type: 'string' },
      },
    },
  },
} as const;
