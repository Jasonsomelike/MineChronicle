import { describe, expect, it } from 'vitest';
import {
  formatPlayTicks,
  formatSeconds,
  formatTickTotal,
  localInputToUtc,
  utcToLocalInput,
} from './duration';

describe('integer tick display', () => {
  it('formats aggregate ticks beyond i64 without rounding', () => {
    expect(formatTickTotal('18446744073709551614')).toBe(
      '256204778801521h 33m 0s',
    );
    expect(() => formatTickTotal('-1')).toThrow();
  });
  it.each([
    ['0', '0s'],
    ['1', '<1s'],
    ['364', '18s'],
    ['1199', '59s'],
    ['1200', '1m 0s'],
    ['72000', '1h 0m 0s'],
    ['73200', '1h 1m 0s'],
    ['9223372036854775807', '128102389400760h 46m 30s'],
  ])('formats %s without float rounding', (input, output) => {
    expect(formatPlayTicks(input)).toBe(output);
  });
  it.each(['-1', '1.2', '', 'NaN', '1e5', '9223372036854775808'])(
    'rejects invalid ticks %s',
    (input) => {
      expect(() => formatPlayTicks(input)).toThrow();
    },
  );
});

describe('second display', () => {
  it.each([
    ['0', '0s'],
    ['59', '59s'],
    ['60', '1m 0s'],
    ['3600', '1h 0m 0s'],
    ['3660', '1h 1m 0s'],
    ['37737', '10h 28m 57s'],
    ['9007199254740993', '2501999792983h 36m 33s'],
  ])('formats %s seconds', (input, output) => {
    expect(formatSeconds(input)).toBe(output);
  });
  it.each(['-1', '1.5', '', 'abc'])('rejects invalid seconds %s', (input) => {
    expect(() => formatSeconds(input)).toThrow();
  });
});

describe('local input round trip', () => {
  /// The archive stores UTC, the input shows local time. If these disagree the
  /// entered end time silently shifts by the timezone offset.
  it('round trips any instant without drifting', () => {
    for (const utc of [
      '2026-09-18T13:52:20Z',
      '2026-09-18T14:25:23Z',
      '2026-01-01T00:00:00Z',
      '2026-12-31T23:59:59Z',
      '2024-02-29T12:00:00Z',
    ]) {
      const local = utcToLocalInput(utc);
      expect(localInputToUtc(local)).toBe(utc);
    }
  });

  it('produces a value the datetime-local input accepts', () => {
    // Exactly `YYYY-MM-DDTHH:MM:SS`, with no timezone suffix or milliseconds:
    // anything else is rejected by the control and shows as empty.
    for (const utc of ['2026-09-18T13:52:20Z', '2026-01-01T00:00:00Z']) {
      expect(utcToLocalInput(utc)).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
      );
    }
  });

  it('has no milliseconds in the stored form', () => {
    const utc = localInputToUtc('2026-09-18T21:52:20');
    expect(utc).toMatch(/Z$/);
    expect(utc).not.toContain('.');
    expect(utc).toHaveLength(20);
  });

  it('returns empty or null rather than an invalid date', () => {
    expect(utcToLocalInput('not-a-date')).toBe('');
    expect(localInputToUtc('not-a-date')).toBeNull();
    expect(localInputToUtc('')).toBeNull();
  });

  /// The offset is real: on this machine local time is UTC+8, so a stored 13:52
  /// displays as 21:52. Asserting the relationship (not the literal hour) keeps
  /// the test valid in any timezone.
  it('applies the machine timezone offset in both directions', () => {
    const utc = '2026-09-18T13:52:20Z';
    const local = utcToLocalInput(utc);
    const offsetMinutes = new Date(utc).getTimezoneOffset();
    const expected = new Date(new Date(utc).getTime() - offsetMinutes * 60_000);
    expect(local.slice(11, 19)).toBe(
      `${String(expected.getUTCHours()).padStart(2, '0')}:` +
        `${String(expected.getUTCMinutes()).padStart(2, '0')}:` +
        `${String(expected.getUTCSeconds()).padStart(2, '0')}`,
    );
  });
});
