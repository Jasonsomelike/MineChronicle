import { describe, it, expect } from 'vitest';
import { trackingTotals } from './tracking';
import type { TrackingSummary } from './tracking';
describe('tracking totals', () => {
  const summary: TrackingSummary = {
    players: [
      {
        uuid: 'a',
        ticks: '9223372036854775807',
        week_ticks: '123',
        month_ticks: '456',
      },
      {
        uuid: 'b',
        ticks: '9223372036854775807',
        week_ticks: '1',
        month_ticks: '2',
      },
    ],
    rollbacks: [],
    rollback_count: 0,
    observations: 2,
    started_at: null,
  };
  it('retains precision beyond SQLite and JavaScript integer totals', () => {
    expect(trackingTotals(summary)).toEqual({
      ticks: 18446744073709551614n,
      week: 124n,
      month: 458n,
    });
  });
  it('filters by UUID and handles pending or unknown players', () => {
    expect(trackingTotals(summary, 'a').week).toBe(123n);
    expect(trackingTotals(summary, 'absent').ticks).toBe(0n);
    expect(trackingTotals(null).ticks).toBe(0n);
    expect(trackingTotals(summary, ['a', 'b', 'a']).week).toBe(124n);
  });
});
