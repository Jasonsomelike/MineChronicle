import { describe, it, expect } from 'vitest';
import { pseudoTotals, trackingTotals } from './tracking';
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
    pseudo: [],
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

describe('pseudo-server totals', () => {
  const entry = (
    name: string,
    seconds: string,
    sessions: number,
    unknown = 0,
  ) => ({
    game_root: `D:\\${name}`,
    instance_name: name,
    seconds,
    week_seconds: seconds,
    month_seconds: seconds,
    sessions,
    unknown_sessions: unknown,
  });

  it('sums across instances', () => {
    const totals = pseudoTotals({
      players: [],
      rollbacks: [],
      rollback_count: 0,
      observations: 0,
      started_at: null,
      pseudo: [entry('server', '3600', 3), entry('other', '1800', 1)],
    });
    expect(totals.seconds).toBe(5400n);
    expect(totals.sessions).toBe(4);
    expect(totals.instances).toBe(2);
  });

  it('reports nothing for an archive without sessions', () => {
    expect(pseudoTotals(null).seconds).toBe(0n);
    expect(pseudoTotals(null).instances).toBe(0);
    expect(
      pseudoTotals({
        players: [],
        rollbacks: [],
        rollback_count: 0,
        observations: 0,
        started_at: null,
        pseudo: [],
      }).seconds,
    ).toBe(0n);
  });

  /// An interrupted session contributes no time but must still be surfaced, so
  /// the user learns that some play went unmeasured rather than seeing a
  /// silently smaller number.
  it('counts sessions with an unknown end without adding their time', () => {
    const totals = pseudoTotals({
      players: [],
      rollbacks: [],
      rollback_count: 0,
      observations: 0,
      started_at: null,
      pseudo: [entry('server', '0', 0, 2)],
    });
    expect(totals.seconds).toBe(0n);
    expect(totals.unknown).toBe(2);
    expect(totals.instances).toBe(0);
  });

  it('keeps precision for long totals', () => {
    const totals = pseudoTotals({
      players: [],
      rollbacks: [],
      rollback_count: 0,
      observations: 0,
      started_at: null,
      pseudo: [
        entry('a', '9007199254740993', 1),
        entry('b', '9007199254740993', 1),
      ],
    });
    expect(totals.seconds).toBe(18014398509481986n);
  });
});
