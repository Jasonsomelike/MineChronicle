/**
 * Sidebar rail collapse preference.
 *
 * The rail already had two shapes: a 192px labelled column, and a 72px icon rail that
 * used to arrive only below 1100px. This module turns the second shape into something the
 * user can also ask for, without declaring a second collapsed layout — the only thing
 * stored is a preference, and `styles/shell.css` applies the same geometry either way.
 *
 * Three states, one of them the default:
 *   'auto'      - nothing is written to the document, so the media queries decide. This is
 *                 what an untouched install has, which is why the toggle cannot change the
 *                 appearance of a window that never asked for it.
 *   'collapsed' - the icon rail at every width above the 860px strip tier.
 *   'expanded'  - the labelled rail, requested deliberately rather than by default.
 *
 * Written to `<html data-rail>` rather than kept in React state alone, for the same reason
 * the theme is written to `<html data-theme>`: the resolution happens in one place (CSS +
 * one attribute), not in two that can disagree. It is also applied before React renders
 * (see `main.tsx`), so a collapsed rail does not paint expanded for one frame and then
 * jump.
 *
 * Why the choice may win over the breakpoint, but not always: the media queries exist to
 * stop the layout being crushed, so they are the floor and the preference is the ceiling.
 * At 1075px a 192px rail would leave 809px of content, so `collapsed` is honoured there
 * and `expanded` is not; at 2048px there is room for either, so the preference decides.
 * The two can therefore never double-apply: where both say "compact", the rules that
 * apply are identical and the last declaration wins with the same values.
 */

export type RailPreference = 'auto' | 'collapsed' | 'expanded';

const STORAGE_KEY = 'minechronicle.rail';

/** The breakpoint at which the labelled rail stops being the default. Mirrors the
 *  `@media` block in `styles/shell.css`; used to describe the default, never to apply it.
 *  CSS is the only thing that lays out; this number exists so the toggle's label matches
 *  what the CSS is about to do. */
const COMPACT_AT = 1400;

function hasDom() {
  return typeof document !== 'undefined' && typeof window !== 'undefined';
}

export function isRailPreference(value: unknown): value is RailPreference {
  return value === 'auto' || value === 'collapsed' || value === 'expanded';
}

export function loadRailPreference(): RailPreference {
  if (!hasDom()) return 'auto';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return 'auto';
    // Accepts both the raw JSON string `"collapsed"` and a bare `collapsed`, so a value
    // written by hand or by an older build is still understood rather than silently
    // resetting the user's choice.
    const parsed: unknown = stored.startsWith('"')
      ? JSON.parse(stored)
      : stored;
    return isRailPreference(parsed) ? parsed : 'auto';
  } catch {
    // Blocked storage, or a value that is not JSON at all: following the breakpoint is
    // the safe default, and the preference stays usable for this session.
    return 'auto';
  }
}

export function saveRailPreference(preference: RailPreference): void {
  if (!hasDom()) return;
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // A failed write only means the choice does not survive a restart. The current
    // session still applies it through `applyRail`, so this is not worth an error.
  }
}

/**
 * Write the preference to the document. Safe to call before render.
 *
 * 'auto' removes the attribute outright rather than writing `data-rail="auto"`: the CSS
 * is written against "the attribute is one of the two explicit values", and a third value
 * that happens to mean "neither" is how a selector like `[data-rail]` quietly starts
 * matching the default case.
 */
export function applyRail(preference: RailPreference): void {
  if (!hasDom()) return;
  const root = document.documentElement;
  if (preference === 'auto') delete root.dataset.rail;
  else root.dataset.rail = preference;
}

/** Whether the rail is collapsed when the user has expressed no preference at all. */
export function autoCollapsed(viewportWidth?: number): boolean {
  const width =
    viewportWidth ??
    (hasDom() ? document.documentElement.clientWidth : COMPACT_AT + 1);
  return width <= COMPACT_AT;
}

/**
 * What the toggle should offer a pointer, and therefore which shape the CSS is about to
 * give the rail. Below the breakpoint the media query has already collapsed it, so
 * answering from the preference alone would offer "收起" on a rail that is already at
 * 72px - a no-op button.
 *
 * `expanded` is what the user asked for; the breakpoint is what they get. This function
 * reports what they get. The browser check agrees (`scripts/qa-rail-toggle.mjs`: clicked
 * at 900px, the rail stays 72px and the control relabels itself 收起侧边栏).
 *
 * There is no `viewportWidth` argument: the only branch that depends on the width is
 * `auto`, and `autoCollapsed()` reads it from the document itself. A parameter here would
 * be a second, unused way to say the same thing.
 */
export function railIsCollapsed(preference: RailPreference): boolean {
  if (preference === 'collapsed') return true;
  if (preference === 'expanded') return false;
  return autoCollapsed();
}
