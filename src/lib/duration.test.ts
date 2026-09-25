import { describe, expect, it } from 'vitest';
import {
  formatCompactTicks,
  formatGroupSeconds,
  formatPlayTicks,
  formatSeconds,
  formatTickTotal,
  localInputToUtc,
  UNKNOWN_DURATION,
  utcToLocalInput,
} from './duration';

describe('integer tick display', () => {
  it('formats aggregate ticks beyond i64 without rounding', () => {
    expect(formatTickTotal('18446744073709551614')).toBe(
      '10675199116730 天 1 小时',
    );
    expect(() => formatTickTotal('-1')).toThrow();
  });
  it.each([
    ['0', '0 秒'],
    ['1', '不足 1 秒'],
    ['20', '1 秒'],
    ['364', '18 秒'],
    ['1199', '59 秒'],
    ['1200', '1 分'],
    ['72000', '1 小时'],
    ['73200', '1 小时 1 分'],
    ['9223372036854775807', '5337599558365 天'],
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
    ['0', '0 秒'],
    ['59', '59 秒'],
    ['60', '1 分'],
    ['3600', '1 小时'],
    ['3660', '1 小时 1 分'],
    ['37737', '10 小时 28 分'],
    ['9007199254740993', '104249991374 天 7 小时'],
  ])('formats %s seconds', (input, output) => {
    expect(formatSeconds(input)).toBe(output);
  });
  it.each(['-1', '1.5', '', 'abc'])('rejects invalid seconds %s', (input) => {
    expect(() => formatSeconds(input)).toThrow();
  });
  it('prints the unknown marker for a group that measured nothing', () => {
    // `ObservationGroup.seconds` is empty when every session in the group ended
    // unobserved or lacks a baseline. That reading must not reach the strict
    // formatter (it took the whole observation page down with
    // `Seconds must be non-negative`), and must not print `0 秒` either, which
    // would claim a measurement the archive does not have.
    expect(formatGroupSeconds('')).toBe(UNKNOWN_DURATION);
    expect(formatGroupSeconds('0')).toBe('0 秒');
    expect(formatGroupSeconds('1500')).toBe(formatSeconds('1500'));
  });
});

/// The point of this block is the equality, not the wording: a duration read off the
/// hero, off a ruler row and off a table cell has to be one string, or a reader sees
/// the same quantity written twice and concludes the data disagrees with itself.
describe('one wording for one duration', () => {
  /* Within i64, which is where `formatPlayTicks` draws its line: it is the exit the
     IPC boundary reads, and a sum past the counter's range is a bug rather than a
     reading. `formatTickTotal` is the one that must survive an oversized sum. */
  it.each([
    '0',
    '1',
    '1199',
    '1200',
    '73200',
    '20736000',
    '9223372036854775807',
  ])('prints %s identically through every exit', (ticks) => {
    const readings = [
      formatTickTotal(ticks),
      formatCompactTicks(ticks),
      formatPlayTicks(ticks),
    ];
    expect(new Set(readings).size).toBe(1);
    expect(readings[0].length).toBeGreaterThan(0);
  });

  it('reads a tick count and the same duration in seconds the same way', () => {
    // 73200 ticks = 3660 seconds = 1 hour 1 minute.
    expect(formatSeconds('3660')).toBe(formatTickTotal('73200'));
  });

  it('uses the interface language for units, not the h/m/s shorthand', () => {
    // Three exits, three sizes, one unit language: no `h`, `m` or `s` survives.
    for (const reading of [
      formatTickTotal('73200'),
      formatCompactTicks('20736000'),
      formatSeconds('37737'),
    ]) {
      expect(reading).not.toMatch(/[hms]/);
    }
  });

  it('reserves one marker for a reading that does not exist', () => {
    expect(UNKNOWN_DURATION).toBe('—');
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
