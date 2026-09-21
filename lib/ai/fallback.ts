import type { ClaimedJob } from '../queue/types';
import { clampSummary, normalizeTags } from './guardrails';

const VAGUE_BUDGET = /\b(tbd|unknown|not decided|undecided|open|flexible|n\/a|none)\b/i;
const VAGUE_TIMELINE = /\b(asap|urgent|yesterday|immediately|tbd|flexible|not sure)\b/i;
const REGULATED = /\b(hipaa|gdpr|pci|soc ?2|phi|pii|fedramp|hl7)\b/i;
const INTEGRATION = /\b(integrat\w*|migrat\w*|legacy|on-?prem|salesforce|sap|epic|mainframe)\b/i;

const firstSentences = (text: string, count: number) =>
  text
    .split(/(?<=[.!?])\s+/)
    .slice(0, count)
    .join(' ')
    .trim();

// Runs when the model is unreachable, so it must not throw: every field it reads was already
// validated by the create form.
export function heuristicTriage(intake: ClaimedJob['intake']) {
  const risks: string[] = [];

  if (VAGUE_BUDGET.test(intake.budgetRange)) {
    risks.push('Budget is not pinned down, so scope will be hard to hold.');
  }
  if (VAGUE_TIMELINE.test(intake.timeline)) {
    risks.push('Timeline is vague. Agree a date before committing anyone.');
  }
  if (intake.description.length < 200) {
    risks.push('The brief is thin. Expect a discovery call before any estimate.');
  }
  if (REGULATED.test(intake.description)) {
    risks.push('Mentions regulated data, so budget for a compliance review.');
  }
  if (INTEGRATION.test(intake.description)) {
    risks.push('Touches existing systems, which is where this kind of project usually overruns.');
  }

  return {
    summary: clampSummary(
      `${intake.title}. ${firstSentences(intake.description, 2)} A ${intake.industry} request with a ${intake.budgetRange} budget over ${intake.timeline}.`,
    ),
    tags: normalizeTags([intake.industry, 'needs-review'], ['auto-triage', 'unclassified']),
    risks: risks.slice(0, 5),
  };
}
