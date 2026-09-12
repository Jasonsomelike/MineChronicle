import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  normalizePlayerUuid,
  readSelfPlayer,
  resolveSelfPlayer,
  saveSelfPlayer,
} from './selfPlayer';

const uuid = 'b0e9bd79-52ec-45c0-ad53-d92995098e1d';
const other = 'a0e9bd79-52ec-45c0-ad53-d92995098e1d';
const players: [string, string][] = [
  [uuid, 'Steve'],
  [other, 'Alex'],
];
afterEach(() => vi.unstubAllGlobals());

describe('self player identity', () => {
  it('accepts UUIDs with or without separators and preserves the archive ID', () => {
    expect(normalizePlayerUuid(uuid.replaceAll('-', '').toUpperCase())).toBe(
      uuid,
    );
    expect(resolveSelfPlayer(` ${uuid.toUpperCase()} `, players)).toEqual([
      players[0],
    ]);
    expect(normalizePlayerUuid('b0e9-bd7952ec45c0ad53d92995098e1d')).toBeNull();
  });
  it('matches a complete name case-insensitively', () => {
    expect(resolveSelfPlayer(' steve ', players)).toEqual([players[0]]);
    expect(resolveSelfPlayer('Ste', players)).toEqual([]);
  });
  it('selects every matching name while UUID selects only one account', () => {
    const duplicates: [string, string][] = [
      [uuid, 'Steve'],
      [other, 'Steve'],
    ];
    expect(resolveSelfPlayer(' steVE ', duplicates)).toEqual(duplicates);
    expect(resolveSelfPlayer(other, duplicates)).toEqual([duplicates[1]]);
  });
  it('keeps unconfigured and not-yet-imported identities unselected', () => {
    expect(resolveSelfPlayer('', players)).toEqual([]);
    expect(resolveSelfPlayer(uuid, [])).toEqual([]);
    expect(resolveSelfPlayer('Unknown', players)).toEqual([]);
  });
  it('persists, notifies mounted pickers, and clears the preference', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    const listener = vi.fn();
    target.addEventListener('minechronicle:self-player-change', listener);
    await saveSelfPlayer(uuid.replaceAll('-', '').toUpperCase());
    expect(readSelfPlayer()).toBe(uuid);
    await saveSelfPlayer(' Steve ');
    expect(readSelfPlayer()).toBe('Steve');
    await saveSelfPlayer(' ');
    expect(readSelfPlayer()).toBe('');
    expect(listener).toHaveBeenCalledTimes(3);
  });
  it('keeps the archive accessible when preference storage cannot be read', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
    });
    expect(readSelfPlayer()).toBe('');
  });
});
