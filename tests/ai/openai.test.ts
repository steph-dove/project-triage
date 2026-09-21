import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import { classify, parseTriageOutput, partialSummary } from '../../lib/ai/openai';
import { UnprocessableIntakeError } from '../../lib/ai/types';
import { RetriableError } from '../../lib/queue/types';

const live = new AbortController().signal;

const apiError = (status: number, code?: string) =>
  new OpenAI.APIError(status, { message: `boom ${status}`, code }, `boom ${status}`, undefined);

describe('classify', () => {
  it('retries the statuses worth retrying', () => {
    for (const status of [408, 409, 429, 500, 503]) {
      expect(classify(apiError(status), live)).toBeInstanceOf(RetriableError);
    }
  });

  it('treats a rejected intake as fallbackable, not as a broken deployment', () => {
    expect(classify(apiError(400, 'context_length_exceeded'), live)).toBeInstanceOf(
      UnprocessableIntakeError,
    );
    expect(classify(apiError(400, 'content_policy_violation'), live)).toBeInstanceOf(
      UnprocessableIntakeError,
    );
    expect(classify(apiError(422), live)).toBeInstanceOf(UnprocessableIntakeError);
  });

  it('hard fails a 400 that is about the request rather than the intake', () => {
    // A model that cannot do json_schema answers like this, and degrading every intake to
    // FALLBACK would bury it.
    for (const err of [apiError(400), apiError(400, 'invalid_value')]) {
      const classified = classify(err, live);

      expect(classified).toBeInstanceOf(Error);
      expect(classified).not.toBeInstanceOf(UnprocessableIntakeError);
      expect(classified).not.toBeInstanceOf(RetriableError);
    }
  });

  it('hard fails on the statuses that mean the deployment is wrong', () => {
    for (const status of [401, 403, 404]) {
      const classified = classify(apiError(status), live);

      expect(classified).toBeInstanceOf(Error);
      expect(classified).not.toBeInstanceOf(RetriableError);
      expect(classified).not.toBeInstanceOf(UnprocessableIntakeError);
    }
  });

  it('hands a shutdown abort straight back for the worker to handle', () => {
    const controller = new AbortController();
    controller.abort();
    const aborted = new OpenAI.APIUserAbortError();

    expect(classify(aborted, controller.signal)).toBe(aborted);
  });

  it('retries an abort that was not a shutdown, which is the timeout', () => {
    expect(classify(new OpenAI.APIUserAbortError(), live)).toBeInstanceOf(RetriableError);
  });

  it('retries anything it cannot place, and passes a RetriableError through', () => {
    const already = new RetriableError('bad JSON');

    expect(classify(new Error('socket hang up'), live)).toBeInstanceOf(RetriableError);
    expect(classify(already, live)).toBe(already);
  });
});

describe('parseTriageOutput', () => {
  const valid = { summary: 'A logistics forecasting pilot.', tags: ['a', 'b', 'c'], risks: [] };

  it('accepts the agreed shape', () => {
    expect(parseTriageOutput(JSON.stringify(valid))).toEqual(valid);
  });

  it.each([
    ['a stream cut off mid-body', '{"summary": "A logistics fore'],
    ['nothing at all', ''],
    ['prose around the JSON', `Here you go: ${JSON.stringify(valid)}`],
    ['a missing field', JSON.stringify({ summary: 'x', tags: [] })],
    ['the wrong type', JSON.stringify({ ...valid, tags: 'a, b, c' })],
    ['an empty summary', JSON.stringify({ ...valid, summary: '' })],
    ['a summary that is only markdown', JSON.stringify({ ...valid, summary: '** __ `' })],
  ])('retries %s rather than saving it', (_case, raw) => {
    expect(() => parseTriageOutput(raw)).toThrow(RetriableError);
  });
});

describe('partialSummary', () => {
  it('reads the summary out of a body that is still being written', () => {
    expect(partialSummary('{"summary": "Half a sent')).toBe('Half a sent');
  });

  it('waits out a half-written escape instead of throwing', () => {
    expect(partialSummary('{"summary": "Half a sent\\')).toBe('Half a sent');
    expect(partialSummary('{"summary": "A quote \\"')).toBe('A quote "');
  });

  it('returns nothing before the summary key arrives', () => {
    expect(partialSummary('{"ta')).toBeUndefined();
  });
});
