import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTheme,
  isThemePreference,
  loadThemePreference,
  resolveTheme,
  saveThemePreference,
  watchSystemTheme,
} from './theme';

/**
 * A minimal document, localStorage and matchMedia so the module's real branches
 * run rather than being stubbed away.
 */
function installDom(prefersDark: boolean, stored: string | null = null) {
  const listeners: (() => void)[] = [];
  let dark = prefersDark;
  const store = new Map<string, string>();
  if (stored !== null) store.set('minechronicle.theme', stored);

  vi.stubGlobal('document', {
    documentElement: { dataset: {} as Record<string, string> },
  });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  });
  vi.stubGlobal('window', {
    // A single object whose `matches` tracks `dark`, because the code holds one
    // MediaQueryList for the life of the subscription: returning a fresh object
    // per call would hide a real change from the listener.
    matchMedia: (query: string) => ({
      get matches() {
        return dark;
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => listeners.push(fn),
      removeEventListener: () => {},
    }),
  });
  return {
    store,
    listeners,
    setDark: (value: boolean) => {
      dark = value;
    },
    dataset: () =>
      (
        document as unknown as {
          documentElement: { dataset: Record<string, string> };
        }
      ).documentElement.dataset,
  };
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('theme preference', () => {
  it('accepts only the three known values', () => {
    expect(isThemePreference('system')).toBe(true);
    expect(isThemePreference('light')).toBe(true);
    expect(isThemePreference('dark')).toBe(true);
    expect(isThemePreference('dusk')).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });

  it('defaults to following the system when nothing is stored', () => {
    installDom(true);
    expect(loadThemePreference()).toBe('system');
  });

  it('round trips a stored choice', () => {
    const dom = installDom(false);
    saveThemePreference('dark');
    expect(dom.store.get('minechronicle.theme')).toBe('dark');
    expect(loadThemePreference()).toBe('dark');
  });

  it('ignores a corrupt stored value instead of trusting it', () => {
    installDom(false, 'midnight');
    expect(loadThemePreference()).toBe('system');
  });

  /// Reading a preference must not throw where storage is unavailable, which is
  /// the case in some sandboxed webviews.
  it('falls back when storage access throws', () => {
    vi.stubGlobal('document', { documentElement: { dataset: {} } });
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    });
    expect(loadThemePreference()).toBe('system');
    expect(() => saveThemePreference('dark')).not.toThrow();
  });
});

describe('resolving the theme', () => {
  it('follows the system only for "system"', () => {
    installDom(true);
    expect(resolveTheme('system')).toBe('dark');
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('reports light when the system prefers light', () => {
    installDom(false);
    expect(resolveTheme('system')).toBe('light');
  });

  /// The override must win even when the system disagrees, which is the entire
  /// reason the attribute is resolved in JS instead of by a media query.
  it('lets a manual choice override a disagreeing system', () => {
    installDom(true);
    expect(resolveTheme('light')).toBe('light');
    installDom(false);
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('writes the resolved value onto the document', () => {
    const dom = installDom(true);
    expect(applyTheme('system')).toBe('dark');
    expect(dom.dataset().theme).toBe('dark');
    expect(applyTheme('light')).toBe('light');
    expect(dom.dataset().theme).toBe('light');
  });
});

describe('following system changes', () => {
  it('reports a change while on "system"', () => {
    const dom = installDom(false);
    const seen: string[] = [];
    watchSystemTheme((theme) => seen.push(theme));
    expect(dom.listeners).toHaveLength(1);
    dom.setDark(true);
    dom.listeners[0]();
    expect(seen).toEqual(['dark']);
  });

  it('unsubscribes without throwing', () => {
    installDom(false);
    const stop = watchSystemTheme(() => {});
    expect(() => stop()).not.toThrow();
  });

  it('is a no-op where matchMedia is unavailable', () => {
    vi.stubGlobal('document', { documentElement: { dataset: {} } });
    vi.stubGlobal('window', {});
    expect(() => watchSystemTheme(() => {})()).not.toThrow();
  });
});
