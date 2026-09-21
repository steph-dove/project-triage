import { describe, expect, it } from 'vitest';
import { relativeTime } from '../../lib/time';

const NOW = new Date('2026-09-21T12:00:00.000Z').getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('relativeTime', () => {
  it.each([
    [30 * SECOND, 'Just now'],
    [2 * MINUTE, '2 minutes ago'],
    [MINUTE, '1 minute ago'],
    [HOUR, '1 hour ago'],
    [3 * HOUR, '3 hours ago'],
    [DAY, 'Yesterday'],
    [2 * DAY, '2 days ago'],
    [6 * DAY, '6 days ago'],
  ])('reads %dms ago as "%s"', (elapsed, expected) => {
    expect(relativeTime(ago(elapsed), NOW)).toBe(expected);
  });

  it('falls back to a date once "days ago" stops being useful', () => {
    expect(relativeTime(ago(30 * DAY), NOW)).toBe('22 Aug 2026');
  });

  it('does not throw on a value that is not a date', () => {
    expect(relativeTime('not a date', NOW)).toBe('Unknown');
  });
});
