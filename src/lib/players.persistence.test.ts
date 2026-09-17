import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialPlayers, initialPlayersNone, savePlayers } from './players';

/** Minimal in-memory localStorage so the round trip is exercised for real. */
function stubStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  });
  return data;
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('player selection persistence', () => {
  it('reads back exactly what savePlayers wrote', () => {
    stubStorage();
    const uuid = 'b0e9bd79-52ec-45c0-ad53-d92995098e1d';
    // Before saving, nothing is restored.
    expect(initialPlayers()).toEqual([]);
    expect(initialPlayersNone()).toBe(false);

    savePlayers([uuid], false);

    expect(initialPlayers()).toEqual([uuid]);
    expect(initialPlayersNone()).toBe(false);
  });

  it('persists the explicit "no player" choice', () => {
    stubStorage();
    savePlayers([], true);
    expect(initialPlayers()).toEqual([]);
    expect(initialPlayersNone()).toBe(true);
  });

  it('round-trips a multi-player combination without duplicates', () => {
    stubStorage();
    const first = 'b0e9bd79-52ec-45c0-ad53-d92995098e1d';
    const second = '00000000-0000-4000-8000-000000000001';
    savePlayers([first, second, first]);
    expect(initialPlayers()).toEqual([first, second]);
  });

  it('ignores malformed stored values and unreadable storage', () => {
    stubStorage({ 'minechronicle.players': '{"not":"an array"}' });
    expect(initialPlayers()).toEqual([]);

    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw Error('blocked');
      },
      setItem: () => {
        throw Error('blocked');
      },
    });
    expect(initialPlayers()).toEqual([]);
    expect(initialPlayersNone()).toBe(false);
    // A blocked write must not throw out of the UI path.
    expect(() => savePlayers(['x'], false)).not.toThrow();
  });
});
