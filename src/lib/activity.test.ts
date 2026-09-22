import { expect, it } from 'vitest';
import {
  formatCount,
  formatDistance,
  formatStatistic,
  statisticRawTitle,
} from './activity';
it('formats counts and centimeters without rounding large integers', () => {
  expect(formatCount('18446744073709551614')).toBe(
    '18,446,744,073,709,551,614',
  );
  expect(formatDistance('12345')).toBe('123.45 米');
  expect(formatDistance('1')).toBe('0.01 米');
  expect(formatDistance('9223372036854775807')).toBe(
    '92,233,720,368,547,758.07 米',
  );
});
it('uses game units without losing large integer precision', () => {
  expect(formatStatistic('1221', 'ticks')).toBe('1m 1s');
  expect(formatStatistic('19', 'ticks')).toBe('<1s');
  expect(formatStatistic('12345', 'centimeters')).toBe('123.45 米');
  expect(formatStatistic('-1', 'centimeters')).toBe('-0.01 米');
  expect(formatStatistic('9223372036854775807', 'damage_tenths')).toBe(
    '922,337,203,685,477,580.7 点伤害',
  );
  expect(formatStatistic('42', 'blocks')).toBe('42 块');
  expect(formatStatistic('42', 'items')).toBe('42 个');
  expect(formatStatistic('42', 'times')).toBe('42 次');
  expect(formatStatistic('42', 'none')).toBe('42');
  expect(statisticRawTitle('35', 'damage_tenths')).toContain(
    '每 10 对应 1 点伤害',
  );
});
