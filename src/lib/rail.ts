/**
 * The hover-expansion state machine for the navigation rail.
 *
 * The rail has one resting shape: a 72px icon column (`--sidebar-w-compact`) that is
 * always the shell's first grid column. There is no second shape stored anywhere - not
 * in localStorage, not on `<html>` - and the same window width always draws the same
 * rail. Expansion is an interaction state, not a preference: pointing at the rail (or
 * focusing into it) opens a 192px overlay (`--sidebar-w`) on top of the content column,
 * and leaving, focusing away, pressing Escape, pressing anywhere else, or blurring the
 * window closes it again. Clicking - navigating included - never closes it: the click
 * lands under a pointer that is still on the rail, so collapsing there would yank the
 * overlay out from under the cursor. `styles/shell.css` owns the geometry; this module
 * owns only the timing.
 *
 * Four states, one of them the resting one:
 *   closed         - nothing pending, rail at 72px.
 *   intent-pending - the pointer arrived and the 100ms intent window is running, so a
 *                    sweep across the rail does not open it.
 *   open           - the overlay is up; `onChange(true)` has been delivered.
 *   grace-pending  - the pointer left and the 150ms leave-grace is running, so a tremble
 *                    across the boundary does not close it; re-entering cancels it.
 *
 * Every close event (light dismiss, Escape, window blur, focus out) cancels
 * both timers on its way out, so no stale timer can fire into a state that has already
 * moved on. `canOpen()` gates the two open events only: below 860px the rail reflows
 * into the top strip (`display: contents`, no box, so pointer events cannot even land on
 * it) and every destination is permanently visible, so an "open" there is meaningless.
 */

/** How long the pointer must rest on the rail before it opens: short enough to feel
 *  instant, long enough that a diagonal sweep across the corner does not open it. */
export const INTENT_DELAY_MS = 100;

/** How long the rail stays open after the pointer leaves: long enough to survive a
 *  tremble across the rail/content boundary, short enough to feel deliberate. */
export const LEAVE_GRACE_MS = 150;

/** The one media query that decides whether a hover overlay can exist at all. Mirrors
 *  the `@media (max-width: 859.98px)` strip block in `styles/shell.css`: written from
 *  opposite sides so the two agree at every width, fractional ones included. */
export const RAIL_OPEN_MEDIA = '(min-width: 860px)';

/** Where the rail's resting shape becomes the labelled column. Mirrors the
 *  `@media (min-width: 1024px)` labelled-tier block in `styles/shell.css`; AppShell
 *  subscribes to it so nav tooltips track the tier without probing `window` in the
 *  render body. */
export const RAIL_LABELLED_MEDIA = '(min-width: 1024px)';

/** The storage key the retired three-state preference was written under. Kept here so
 *  the cleanup and the history it cleans up sit next to each other. */
const LEGACY_STORAGE_KEY = 'minechronicle.rail';

/**
 * One-time removal of the retired `minechronicle.rail` preference.
 *
 * The old model stored a three-state choice and read it before the first paint. The
 * hover model reads nothing and writes nothing, so a key left behind by an older build
 * would sit in storage forever - read by nobody, misunderstood by the next reader. It is
 * removed once at startup (`main.tsx`, before the first render), idempotently, and the
 * removal is best-effort: a blocked store has nothing to clean and must not break boot.
 */
export function clearLegacyRailPreference(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Blocked or unavailable storage: the key, if any, is unreachable, and boot
    // must not care.
  }
}

type RailState = 'closed' | 'intent-pending' | 'open' | 'grace-pending';

export type RailController = {
  /** Pointer arrived on the rail: start the intent window (or cancel a leave-grace). */
  pointerEnter: () => void;
  /** Pointer left the rail: cancel an intent window, or start the leave-grace. */
  pointerLeave: () => void;
  /** Focus moved into the rail: open immediately, with no intent delay. */
  focusIn: () => void;
  /** Focus left the rail for a target outside it: close immediately. */
  focusOut: () => void;
  /** A press landed outside the rail while open (popover light dismiss): close now. */
  lightDismiss: () => void;
  /** Escape was pressed while open: close now. */
  escape: () => void;
  /** The window lost focus: close now, so the overlay cannot outlive its window. */
  windowBlur: () => void;
  /** Whether the overlay is up - the open state and the leave-grace both count, since
   *  the rail is visually open in both. */
  isOpen: () => boolean;
  /** Cancel everything; called when the shell unmounts. */
  destroy: () => void;
};

export type RailControllerOptions = {
  /** Whether an overlay may open at all: `matchMedia(RAIL_OPEN_MEDIA).matches`. */
  canOpen: () => boolean;
  /** Called exactly when the visual state crosses open/closed. */
  onChange: (open: boolean) => void;
  /** Injectable so tests can advance time by hand. */
  setTimeout?: (handler: () => void, timeout: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
};

export function createRailController({
  canOpen,
  onChange,
  setTimeout: schedule = (handler, timeout) =>
    globalThis.setTimeout(handler, timeout),
  clearTimeout: cancel = (handle) => globalThis.clearTimeout(handle as number),
}: RailControllerOptions): RailController {
  let state: RailState = 'closed';
  let intentHandle: unknown = null;
  let graceHandle: unknown = null;

  function cancelIntent() {
    if (intentHandle !== null) {
      cancel(intentHandle);
      intentHandle = null;
    }
  }

  function cancelGrace() {
    if (graceHandle !== null) {
      cancel(graceHandle);
      graceHandle = null;
    }
  }

  function open() {
    cancelIntent();
    cancelGrace();
    state = 'open';
    onChange(true);
  }

  /** Every close event runs through here: both timers die first, so no stray intent or
   *  grace can fire after the rail has already closed. */
  function close() {
    cancelIntent();
    cancelGrace();
    const wasOpen = state === 'open' || state === 'grace-pending';
    state = 'closed';
    if (wasOpen) onChange(false);
  }

  return {
    pointerEnter() {
      if (!canOpen()) {
        // Below the overlay's media query there is no rail to hover; make sure no
        // timer from a resize race survives either.
        cancelIntent();
        return;
      }
      if (state === 'grace-pending') {
        // Back within the grace window: the leave was a tremble, not a departure.
        cancelGrace();
        state = 'open';
        return;
      }
      if (state === 'open' || state === 'intent-pending') return;
      state = 'intent-pending';
      intentHandle = schedule(() => {
        intentHandle = null;
        if (state === 'intent-pending') open();
      }, INTENT_DELAY_MS);
    },

    pointerLeave() {
      if (state === 'intent-pending') {
        // Left before the intent matured: a sweep, not a request.
        cancelIntent();
        state = 'closed';
        return;
      }
      if (state !== 'open') return;
      state = 'grace-pending';
      graceHandle = schedule(() => {
        graceHandle = null;
        if (state === 'grace-pending') close();
      }, LEAVE_GRACE_MS);
    },

    focusIn() {
      if (!canOpen()) return;
      // Keyboard intent is unambiguous - no sweep to guard against - so the rail opens
      // on the spot and the intent window, if any, is dropped.
      open();
    },

    focusOut() {
      close();
    },

    lightDismiss() {
      close();
    },

    escape() {
      close();
    },

    windowBlur() {
      close();
    },

    isOpen() {
      return state === 'open' || state === 'grace-pending';
    },

    destroy() {
      cancelIntent();
      cancelGrace();
      state = 'closed';
    },
  };
}
