/**
 * Focused QA: prove the ErrorBoundary contains a render crash.
 *
 * Run this while a component is temporarily made to throw (see the QA crash
 * injection in Statistics.tsx). It asserts that:
 *   1. the app shell (.app-header) is still rendered, i.e. the crash did not
 *      unmount the whole tree, and
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
await page.goto(crashUrl, { waitUntil: 'domcontentloaded' });
await delay(2000);

const header = await page.locator('.app-header').count();
const fallback = await page.locator('.error-boundary').count();
const alertText = fallback
  ? await page.locator('.error-boundary h2').innerText()
  : '';
console.log(`crashed page: header=${header} fallback=${fallback}`);
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
  header > 0 && fallback > 0 && fallbackAfter === 0 && pageVisible > 0;
console.log(
  pass
    ? 'PASS: crash contained, shell survived, page recovered on revisit'
    : 'FAIL: see counts above',
);
process.exitCode = pass ? 0 : 1;
