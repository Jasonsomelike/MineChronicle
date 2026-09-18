import { describe, expect, it } from 'vitest';
import { formatPlayTicks, formatSeconds, formatTickTotal } from './duration';

describe('integer tick display', () => {
  it('formats aggregate ticks beyond i64 without rounding', () => {
    expect(formatTickTotal('18446744073709551614')).toBe(
      '256204778801521 小时 33 分钟',
    );
    expect(() => formatTickTotal('-1')).toThrow();
  });
  it.each([
    ['0', '0 秒'],
    ['1', '不足 1 秒'],
    ['364', '18 秒'],
    ['1199', '59 秒'],
    ['1200', '1 分钟'],
    ['72000', '1 小时'],
    ['73200', '1 小时 1 分钟'],
    ['9223372036854775807', '128102389400760 小时 46 分钟 30 秒'],
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
    ['60', '1 分钟'],
    ['3600', '1 小时'],
    ['3660', '1 小时 1 分钟'],
    ['37737', '10 小时 28 分钟 57 秒'],
    ['9007199254740993', '2501999792983 小时 36 分钟 33 秒'],
  ])('formats %s seconds', (input, output) => {
    expect(formatSeconds(input)).toBe(output);
  });
  it.each(['-1', '1.5', '', 'abc'])('rejects invalid seconds %s', (input) => {
    expect(() => formatSeconds(input)).toThrow();
  });
});
