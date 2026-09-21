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

  it('truncates a long tag without leaving a hyphen dangling off the end', () => {
    const tag = toTag('Enterprise resource planning migration programme');

    expect(tag.length).toBeLessThanOrEqual(32);
    expect(tag).toBe('enterprise-resource-planning-mig');
    // The 32nd character is the hyphen between "abcd" and "efg".
    expect(toTag('abcdefghijklmnopqrstuvwxyz abcd efg')).toBe('abcdefghijklmnopqrstuvwxyz-abcd');
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

  it('collapses spellings of the same tag into one and fills the gap', () => {
    expect(normalizeTags(['ML Ops', 'ml-ops', '**ML  ops!**'], ['logistics'])).toEqual([
      'ml-ops',
      'logistics',
      'untagged-3',
    ]);
  });

  it('does not let the filler repeat a tag the model already gave', () => {
    expect(normalizeTags(['Logistics'], ['logistics', 'needs-review', 'triage'])).toEqual([
      'logistics',
      'needs-review',
      'triage',
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

  it('leaves a summary of exactly the limit alone', () => {
    const summary = 'a'.repeat(600);

    expect(clampSummary(summary)).toBe(summary);
  });

  it('hard cuts a summary with no space to break on', () => {
    expect(clampSummary('a'.repeat(700))).toBe(`${'a'.repeat(600)}...`);
  });

  it('comes back empty from a summary that was only markdown', () => {
    // Which is why the contract refuses one: see parseTriageOutput.
    expect(clampSummary('**  __ ##')).toBe('');
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
