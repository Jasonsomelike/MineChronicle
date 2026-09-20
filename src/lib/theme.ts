/**
 * Theme selection: follow the system, or override it.
 *
 * Three states, stored as a preference:
 *   'system' - match the OS, and keep matching it if the OS changes
 *   'light'  - always light
 *   'dark'   - always dark
 *
 * The resolved theme is written to `<html data-theme>` rather than left to a
 * `prefers-color-scheme` media query. With a media query a manual choice and the
 * system setting can both match, so the winner depends on source order and the
 * override silently stops working when the system disagrees. Resolving in one
 * place means exactly one attribute drives the whole palette.
 *
 * The attribute is also set before React renders (see `main.tsx`), so a dark
 * session does not flash the light palette first.
 */

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'minechronicle.theme';

/** Cheapest capability check: the QA harness and any non-browser caller. */
function hasDom() {
  return typeof document !== 'undefined' && typeof window !== 'undefined';
}

function systemTheme(): ResolvedTheme {
  if (!hasDom() || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function loadThemePreference(): ThemePreference {
  if (!hasDom()) return 'system';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    // Private mode or a blocked origin: following the system is the safe default.
    return 'system';
  }
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? systemTheme() : preference;
}

/** Write the resolved theme to the document. Safe to call before render. */
export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference);
  if (hasDom()) document.documentElement.dataset.theme = resolved;
  return resolved;
}

export function saveThemePreference(preference: ThemePreference) {
  if (!hasDom()) return;
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // A failed write only means the choice does not survive a restart; the
    // current session still applies it, so this is not worth an error banner.
  }
}

/**
 * Follow the OS while the preference is 'system', and detach as soon as it is
 * not. Returns an unsubscribe function so a React effect can clean up.
 */
export function watchSystemTheme(onChange: (theme: ResolvedTheme) => void) {
  if (!hasDom() || !window.matchMedia) return () => {};
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const listener = () => onChange(query.matches ? 'dark' : 'light');
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
