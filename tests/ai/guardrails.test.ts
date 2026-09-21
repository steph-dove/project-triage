import { describe, expect, it } from 'vitest';
import { applyGuardrails, clampSummary, normalizeTags, toTag } from '../../lib/ai/guardrails';

describe('toTag', () => {
  it('kebab-cases and drops punctuation', () => {
    expect(toTag('Machine Learning!')).toBe('machine-learning');
    expect(toTag('  **RAG / search**  ')).toBe('rag-search');
  });

  it('returns empty for something with no letters in it', () => {
    expect(toTag('!!!')).toBe('');
  });
});

describe('normalizeTags', () => {
  it('always returns exactly three', () => {
    expect(normalizeTags(['one'], ['two', 'three', 'four'])).toEqual(['one', 'two', 'three']);
    expect(normalizeTags(['a', 'b', 'c', 'd', 'e'])).toEqual(['a', 'b', 'c']);
  });

  it('dedupes on the kebab-cased form, not the raw string', () => {
    expect(normalizeTags(['Machine Learning', 'machine-learning', 'nlp'])).toEqual([
      'machine-learning',
      'nlp',
      'untagged-3',
    ]);
  });

  it('skips candidates that kebab-case to nothing', () => {
    expect(normalizeTags(['???', 'ok'], ['---'])).toEqual(['ok', 'untagged-2', 'untagged-3']);
  });
});

describe('clampSummary', () => {
  it('strips markdown and collapses whitespace', () => {
    expect(clampSummary('**Bold**  and `code`\n\nacross lines')).toBe('Bold and code across lines');
  });

  it('cuts a long summary at a word boundary', () => {
    const summary = clampSummary(`${'word '.repeat(200)}end`);

    expect(summary.length).toBeLessThanOrEqual(604);
    expect(summary.endsWith('...')).toBe(true);
    expect(summary).not.toContain('wor...');
  });
});

describe('applyGuardrails', () => {
  it('caps the risks at five and drops the empty ones', () => {
    const guarded = applyGuardrails({
      summary: 'A summary.',
      tags: ['a', 'b', 'c'],
      risks: ['- one', '**two**', '', 'three', 'four', 'five', 'six'],
    });

    expect(guarded.risks).toEqual(['one', 'two', 'three', 'four', 'five']);
  });
});
