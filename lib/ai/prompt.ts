import type { ClaimedJob } from '../queue/types';

export const PROMPT_VERSION = 'triage-v1';

const SYSTEM = [
  'You triage inbound project requests for an AI consultancy.',
  'Summarise what the client wants, label it, and name the risks a delivery lead would want before the first call.',
  'Return exactly three tags, lowercase words with hyphens between them and no other punctuation.',
  'List at most five risks, each specific to this request. Return an empty list when there is nothing worth flagging.',
  'Write plain prose. No markdown, no bullet characters, no preamble.',
].join('\n');

export function buildMessages(intake: ClaimedJob['intake']) {
  return [
    { role: 'system' as const, content: SYSTEM },
    {
      role: 'user' as const,
      content: [
        `Title: ${intake.title}`,
        `Industry: ${intake.industry}`,
        `Budget: ${intake.budgetRange}`,
        `Timeline: ${intake.timeline}`,
        '',
        'Description:',
        intake.description,
      ].join('\n'),
    },
  ];
}
