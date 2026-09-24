import { describe, expect, it } from 'vitest';
import {
  PAGE_GROUP_OF,
  PAGE_GROUPS,
  PAGE_IDS,
  PAGE_LABELS,
  routePage,
  pageHash,
  SETTINGS_SECTIONS,
} from './routes';

describe('app routes', () => {
  it('maps known hashes to pages', () => {
    expect(routePage('#/dashboard')).toBe('dashboard');
    expect(routePage('#/worlds')).toBe('worlds');
    expect(routePage('#health')).toBe('settings');
  });

  it('falls back to dashboard for unknown or empty hashes', () => {
    expect(routePage('')).toBe('dashboard');
    expect(routePage('#/nope')).toBe('dashboard');
  });

  it('round-trips page hashes', () => {
    for (const id of PAGE_IDS) {
      expect(routePage(pageHash(id))).toBe(id);
    }
  });

  it('labels every page and settings section', () => {
    for (const id of PAGE_IDS) {
      expect(PAGE_LABELS[id].length).toBeGreaterThan(0);
    }
    expect(SETTINGS_SECTIONS.length).toBe(5);
  });

  /// The rail draws its headings from `PAGE_GROUPS` and its destinations from the
  /// filter over `PAGE_GROUP_OF`, so a missing entry would drop a destination without
  /// failing anything else - the one outcome the grouping must not have.
  it('files every page under exactly one of the declared groups', () => {
    const declared = PAGE_GROUPS.map(([group]) => group);
    const counts = new Map<string, number>();
    for (const id of PAGE_IDS) {
      const group = PAGE_GROUP_OF[id];
      expect(declared).toContain(group);
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }
    for (const [group, label] of PAGE_GROUPS) {
      expect(label.length).toBeGreaterThan(0);
      // A heading over nothing is an empty block in the rail.
      expect(counts.get(group) ?? 0).toBeGreaterThan(0);
    }
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(
      PAGE_IDS.length,
    );
  });

  it('uses declared settings-* ids that stay unique', () => {
    const ids = SETTINGS_SECTIONS.map(([id]) => id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^settings-[a-z]+$/);
    }
    expect(ids).toEqual([
      'settings-identity',
      'settings-startup',
      'settings-import',
      'settings-archive',
      'settings-health',
    ]);
  });
});
