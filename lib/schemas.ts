import { z } from 'zod';

export const TRIAGE_STATUSES = ['NEW', 'IN_REVIEW', 'ACCEPTED', 'DECLINED'] as const;
export type TriageStatus = (typeof TRIAGE_STATUSES)[number];

export const ENRICHMENT_STATES = ['PENDING', 'PROCESSING', 'READY', 'FAILED'] as const;
export type EnrichmentState = (typeof ENRICHMENT_STATES)[number];

// Zod's default message for a missing key is the bare word "Required".
const requiredString = (message: string) =>
  z.string({ required_error: message, invalid_type_error: message }).trim().min(1, message);

// Imported by the create form as well, so client and server cannot drift.
export const CreateIntakeSchema = z.object({
  title: requiredString('Give the request a title.').max(
    200,
    'Keep the title under 200 characters.',
  ),
  description: requiredString(
    'Give at least 40 characters so the triage summary has something to work with.',
  )
    .min(40, 'Give at least 40 characters so the triage summary has something to work with.')
    .max(5000, 'Keep the description under 5000 characters.'),
  budgetRange: requiredString('Give a budget range, or say it is not decided yet.').max(
    100,
    'Keep the budget range short.',
  ),
  timeline: requiredString('Give a timeline, or say it is flexible.').max(
    100,
    'Keep the timeline short.',
  ),
  industry: requiredString('Give an industry.').max(100, 'Keep the industry short.'),
});

export type CreateIntakeInput = z.infer<typeof CreateIntakeSchema>;

export const UpdateIntakeSchema = z.object({
  status: z.enum(TRIAGE_STATUSES, {
    errorMap: () => ({ message: `Status must be one of ${TRIAGE_STATUSES.join(', ')}.` }),
  }),
});

// Past this the offset stops fitting in the 64-bit integer Prisma hands SQLite, and the
// query throws instead of coming back empty.
export const MAX_PAGE = 1_000_000;

export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 50;

// Out-of-range numbers clamp, unparseable ones fall back to the default. Junk in the URL bar
// is a typo, not a reason to 400.
export const ListIntakesQuerySchema = z.object({
  page: z.coerce
    .number()
    .int()
    .catch(1)
    .transform((n) => Math.min(Math.max(n, 1), MAX_PAGE)),
  pageSize: z.coerce
    .number()
    .int()
    .catch(DEFAULT_PAGE_SIZE)
    .transform((n) => Math.min(Math.max(n, 1), MAX_PAGE_SIZE)),
  status: z.enum(TRIAGE_STATUSES).optional().catch(undefined),
});

export type ListIntakesQuery = z.infer<typeof ListIntakesQuerySchema>;
