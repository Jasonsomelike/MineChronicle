import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyRail,
  autoCollapsed,
  loadRailPreference,
  railIsCollapsed,
  saveRailPreference,
} from './rail';

let storage: Map<string, string>;
let root: { dataset: Record<string, string> };

beforeEach(() => {
  storage = new Map();
  root = { dataset: {} };
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal('document', { documentElement: root });
  vi.stubGlobal('window', {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('rail preference', () => {
  it('defaults to auto so an untouched install follows the breakpoint', () => {
    expect(loadRailPreference()).toBe('auto');
    expect(root.dataset.rail).toBeUndefined();
  });

  it('round-trips an explicit choice and writes it to the document', () => {
    saveRailPreference('collapsed');
    expect(loadRailPreference()).toBe('collapsed');
    applyRail('collapsed');
    expect(root.dataset.rail).toBe('collapsed');

    saveRailPreference('expanded');
    applyRail('expanded');
    expect(loadRailPreference()).toBe('expanded');
    expect(root.dataset.rail).toBe('expanded');
  });

  it('removes the attribute for auto rather than writing a third value', () => {
    applyRail('collapsed');
    expect(root.dataset.rail).toBe('collapsed');
    applyRail('auto');
    expect(root.dataset.rail).toBeUndefined();
    expect('rail' in root.dataset).toBe(false);
  });

  it('understands a bare value as well as the JSON one', () => {
    storage.set('minechronicle.rail', 'collapsed');
    expect(loadRailPreference()).toBe('collapsed');
    storage.set('minechronicle.rail', '"expanded"');
    expect(loadRailPreference()).toBe('expanded');
  });

  it('falls back to auto for anything it cannot read', () => {
    for (const invalid of ['', '"125"', '{}', 'yes', 'Collapsed']) {
      storage.set('minechronicle.rail', invalid);
      expect(loadRailPreference()).toBe('auto');
    }
  });

  it('remains usable when preference storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('Storage disabled');
      },
      setItem: () => {
        throw new Error('Storage disabled');
      },
    });
    expect(loadRailPreference()).toBe('auto');
    expect(() => saveRailPreference('collapsed')).not.toThrow();
  });
});

describe('rail resolution against the breakpoint', () => {
  it('treats the breakpoint as the default and the preference as the ceiling', () => {
    // No preference: the breakpoint decides.
    expect(autoCollapsed(2048)).toBe(false);
    expect(autoCollapsed(1401)).toBe(false);
    expect(autoCollapsed(1400)).toBe(true);
    expect(autoCollapsed(900)).toBe(true);
  });

  it('honours either explicit choice where there is room for it', () => {
    expect(railIsCollapsed('collapsed')).toBe(true);
    expect(railIsCollapsed('expanded')).toBe(false);
    expect(railIsCollapsed('auto')).toBe(false); // the stub document is wide
  });

  it('reads the width from the document for auto rather than a second argument', () => {
    vi.stubGlobal('document', { documentElement: { clientWidth: 900 } });
    expect(railIsCollapsed('auto')).toBe(true);
    expect(railIsCollapsed('expanded')).toBe(false);
    expect(railIsCollapsed('collapsed')).toBe(true);
  });

  it('reports the rail the CSS will draw, not the preference the user filed', () => {
    // At 900px the media query has already collapsed the rail. Answering "expanded" here
    // would label the control 收起 and put a no-op in front of the user; the browser
    // check confirms the rail stays 72px and the label flips to 展开侧边栏.
    vi.stubGlobal('document', { documentElement: { clientWidth: 900 } });
    expect(railIsCollapsed('expanded')).toBe(false);
  });
});
