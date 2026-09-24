/* global window, location */
/**
 * Focused QA: prove the ErrorBoundary contains a render crash.
 *
 * The crash is injected by this script, from the `?qaCrash=1` flag alone: the flag makes
 * the observer payload carry one record whose first field access throws, so the page's
 * own render throws the way a malformed archive row would. It used to be a `throw` pasted
 * by hand into a page component before running this, which is why a plain run reported
 * `fallback=0` and FAIL every time - the "failure" was the missing injection, not the
 * boundary. Nothing in `src/` has to change now, and the injection is confined to the run
 * that carries the flag.
 *
 * It asserts that:
 *   1. the app shell is still rendered (its nav landmark and its seven page
 *      buttons), i.e. the crash did not unmount the whole tree, and
 *   2. the boundary fallback is visible for that page.
 * Then it navigates to the same page without the crash flag and confirms the
 * page recovers (the resetKey retry path).
 */
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const base = 'http://127.0.0.1:1420';

// This script never starts a server: start `npm run dev` yourself and keep it
// running, so the check cannot leave an orphaned vite process behind.
// The first request compiles the app and can take ~20 s on a cold cache, so
// retry instead of failing on a single short timeout.
async function reachable() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const response = await fetch(base, {
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) return true;
    } catch {
      /* retry below */
    }
    await delay(2000);
  }
  return false;
}

if (!(await reachable())) {
  console.error(
    `开发服务器未就绪：请先在另一个终端运行 npm run dev，并确认 ${base} 可访问。`,
  );
  process.exit(2);
}

const crashUrl = process.argv[2] ?? `${base}/?qaCrash=1#/observation`;
const okUrl = `${base}/#/observation`;

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();

/* Runs before the app boots, and only for a document that carries the flag. The row is a
   plain object with one throwing accessor, so the failure is raised where the field is
   read - inside the page's render - rather than at import time, which would take the
   shell down with it and fail assertion 1 for the wrong reason.

   `observed_sessions_page` is the command the observation page's loader issues
   (`src/lib/tracking.ts`), and `started_at` is read by the row renderer, so the thrown
   error lands in the boundary the way a corrupt record's would. */
await page.addInitScript(() => {
  if (!new URLSearchParams(location.search).has('qaCrash')) return;
  const row = {
    id: 1,
    game_root: 'D:\\QA\\crash',
    instance_name: 'QA 崩溃注入',
    pseudo_seconds: '0',
    ended_at: null,
    ended_source: null,
    missing_baseline: false,
  };
  Object.defineProperty(row, 'started_at', {
    get() {
      throw new Error('QA 崩溃注入：这条观测记录的开始时间损坏');
    },
  });
  window.isTauri = true;
  window.__TAURI_INTERNALS__ = {
    transformCallback: (callback) => callback,
    invoke: async (command) =>
      command === 'observed_sessions_page'
        ? {
            sessions: [row],
            groups: undefined,
            total: 1,
            page: 1,
            page_size: 20,
            total_seconds: '0',
            unknown_sessions: 0,
            baseline_sessions: 0,
            running_sessions: 0,
          }
        : null,
  };
});

await page.goto(crashUrl, { waitUntil: 'domcontentloaded' });
await delay(2000);

const shellNav = await page.locator('.app-shell .app-nav button').count();
const fallback = await page.locator('.error-boundary').count();
const alertText = fallback
  ? await page.locator('.error-boundary h2').innerText()
  : '';
console.log(`crashed page: shellNavButtons=${shellNav} fallback=${fallback}`);
if (alertText) console.log(`  fallback heading: ${alertText}`);

// Same page without the crash flag: the boundary must retry and render.
await page.goto(okUrl, { waitUntil: 'domcontentloaded' });
await delay(4000);
const fallbackAfter = await page.locator('.error-boundary').count();
const pageVisible = await page.locator('.instance-observation').count();
console.log(
  `recovered page: fallback=${fallbackAfter} instanceObservation=${pageVisible}`,
);

await browser.close();

const pass =
  shellNav > 0 && fallback > 0 && fallbackAfter === 0 && pageVisible > 0;
console.log(
  pass
    ? 'PASS: crash contained, shell survived, page recovered on revisit'
    : 'FAIL: see counts above',
);
process.exitCode = pass ? 0 : 1;
