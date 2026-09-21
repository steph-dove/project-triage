import type { TriageOutput } from './contract';

const MAX_SUMMARY_CHARS = 600;
const TAG_COUNT = 3;
const MAX_RISKS = 5;

export const stripMarkdown = (text: string) =>
  text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]/g, '')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

export const toTag = (raw: string) =>
  stripMarkdown(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 32)
    .replace(/^-+|-+$/g, '');

export function clampSummary(raw: string) {
  const text = stripMarkdown(raw);
  if (text.length <= MAX_SUMMARY_CHARS) return text;

  const cut = text.slice(0, MAX_SUMMARY_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : MAX_SUMMARY_CHARS).trimEnd()}...`;
}

// The filler makes up the shortfall when the model returns fewer than three usable tags.
export function normalizeTags(raw: string[], filler: string[] = []) {
  const tags: string[] = [];

  for (const candidate of [...raw, ...filler]) {
    if (tags.length === TAG_COUNT) break;
    const tag = toTag(candidate);
    if (tag && !tags.includes(tag)) tags.push(tag);
  }

  while (tags.length < TAG_COUNT) tags.push(`untagged-${tags.length + 1}`);
  return tags;
}

export function applyGuardrails(output: TriageOutput, filler: string[] = []) {
  return {
    summary: clampSummary(output.summary),
    tags: normalizeTags(output.tags, filler),
    risks: output.risks.map(stripMarkdown).filter(Boolean).slice(0, MAX_RISKS),
  };
}
