import { describe, expect, it, vi } from 'vitest';
import { encodeFrame, parseFrame, resumePoint, type StreamEvent } from '../../lib/stream';

const event: StreamEvent = {
  seq: 42,
  intakeId: 'intake-1',
  type: 'READY',
  payload: { source: 'LLM' },
  createdAt: '2026-09-20T12:00:00.000Z',
};

describe('encodeFrame', () => {
  it('puts the sequence in the id line, which is what a reconnect resumes from', () => {
    const [id] = encodeFrame(event).split('\n');

    expect(id).toBe('id: 42');
  });

  it('ends on the blank line that closes a frame', () => {
    expect(encodeFrame(event).endsWith('\n\n')).toBe(true);
  });

  it('survives the round trip a browser puts it through', () => {
    const data = encodeFrame(event)
      .split('\n')
      .find((line) => line.startsWith('data: '))!
      .slice('data: '.length);

    expect(parseFrame(data)).toEqual(event);
  });
});

describe('parseFrame', () => {
  it('drops a frame that is not JSON rather than throwing into the reducer', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(parseFrame('{ not json')).toBeNull();
    expect(logged).toHaveBeenCalled();

    logged.mockRestore();
  });

  it('drops a frame carrying an event type this build does not know', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(parseFrame(JSON.stringify({ ...event, type: 'TELEPORTED' }))).toBeNull();

    logged.mockRestore();
  });

  it('keeps a null payload, because most events do not carry one', () => {
    expect(parseFrame(JSON.stringify({ ...event, payload: null }))?.payload).toBeNull();
  });
});

describe('resumePoint', () => {
  it('reads the cursor a reconnecting browser sends back', () => {
    expect(resumePoint('4201')).toBe(4201);
  });

  it('has no opinion when the header is missing, because Number(null) is 0', () => {
    // A 0 here would look like a valid cursor and replay the entire event log to a page that
    // only wanted what happens next.
    expect(resumePoint(null)).toBeUndefined();
    expect(resumePoint('   ')).toBeUndefined();
  });

  it('ignores a cursor that is not a sequence number', () => {
    expect(resumePoint('tomorrow')).toBeUndefined();
    expect(resumePoint('-1')).toBeUndefined();
    expect(resumePoint('1.5')).toBeUndefined();
    expect(resumePoint('99999999999999999999')).toBeUndefined();
  });
});
