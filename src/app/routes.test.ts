import { describe, expect, it } from 'vitest';
import {
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
