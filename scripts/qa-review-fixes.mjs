/* global window, document, getComputedStyle */
import { chromium } from 'playwright-core';
import { backend, APP_VERSION } from './qa-fixtures.mjs';
import { installObservationFixture } from './qa-observation-fixture.mjs';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  });
  await context.addInitScript(installObservationFixture, backend);
  const page = await context.newPage();
  await page.addInitScript((version) => {
    const old = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === 'archive_status')
        return {
          version,
          database_path: 'D:\\QA\\archive.sqlite3',
          pending_restore: !!window.__qa.pending,
          pending: window.__qa.pending
            ? {
                source: window.__qa.restored,
                scheduled_at: '2026-09-18T10:00:00Z',
              }
            : null,
          policy: {
            enabled: true,
            retention: 7,
            directory: 'D:\\QA\\backups',
            error: '',
            records: [],
          },
        };
      if (command === 'inspect_archive_backup')
        return new Promise((resolve, reject) => {
          window.__qa.resolveInspect = () =>
            resolve({
              path: args.path,
              created_at: '2026-09-18T10:00:00Z',
              worlds: 99,
              observations: 123,
              schema: 7,
              digest: 'verified-digest',
            });
          window.__qa.rejectInspect = () => reject(Error('file changed'));
        });
      if (command === 'schedule_archive_restore') {
        window.__qa.restored = args.path;
        window.__qa.digest = args.expectedDigest;
        window.__qa.pending = true;
        return;
      }
      if (command === 'cancel_archive_restore') {
        window.__qa.pending = false;
        return;
      }
      if (command === 'choose_archive_backup') return 'D:\\QA\\chosen.sqlite3';
      return old(command, args);
    };
  }, APP_VERSION);
  await page.goto('http://127.0.0.1:1420/#/settings');
  const section = page.locator('#settings-archive');
  await section.getByText('选择备份并恢复', { exact: true }).click();
  const input = section.getByLabel('或输入备份文件完整路径');
  await input.fill('D:\\QA\\A.sqlite3');
  await section.getByRole('button', { name: '校验并预览' }).click();
  await page.waitForFunction(() => !!window.__qa.resolveInspect);
  await input.fill('D:\\QA\\B.sqlite3');
  await page.evaluate(() => window.__qa.resolveInspect());
  await page.waitForFunction(
    () =>
      document.querySelector('#settings-archive').getAttribute('aria-busy') ===
      'false',
  );
  assert.equal(await section.getByLabel('我已确认要恢复这份档案').count(), 0);
  await section.getByRole('button', { name: '校验并预览' }).click();
  await page.evaluate(() => window.__qa.resolveInspect());
  await section.getByLabel('我已确认要恢复这份档案').check();
  await section.getByRole('button', { name: '备份当前档案并准备恢复' }).click();
  await section.getByRole('button', { name: '取消待恢复' }).waitFor();
  assert.deepEqual(
    await page.evaluate(() => [window.__qa.restored, window.__qa.digest]),
    ['D:\\QA\\B.sqlite3', 'verified-digest'],
  );
  await section.getByRole('button', { name: '取消待恢复' }).click();
  await section
    .getByText('已取消恢复，当前档案保持不变', { exact: true })
    .waitFor();
  assert.equal(
    await section.getByRole('button', { name: '重启并完成恢复' }).count(),
    0,
  );
  await section.getByRole('button', { name: '校验并预览' }).click();
  await page.evaluate(() => window.__qa.rejectInspect());
  await section
    .getByRole('alert')
    .filter({ hasText: 'file changed' })
    .waitFor();
  assert.equal(await section.getByLabel('我已确认要恢复这份档案').count(), 0);
  await section.getByRole('button', { name: '浏览备份文件' }).click();
  await page.waitForFunction(() =>
    document
      .querySelector('#settings-archive input[placeholder]')
      .value.endsWith('chosen.sqlite3'),
  );

  // --- Geometry guards for the three defects fixed in this batch -----------
  // All three were CSS outcomes, so nothing else in the suite could see them: a
  // checkbox that is 220x38 still "renders", an icon stacked above its label
  // still "exists", and a chip keeps its text when it loses its colour. Pinned
  // here rather than in a throwaway probe.

  /**
   * Every checkbox in the app is 16-18px. `.scan-panel input` used to hand the
   * 自动备份 box the text-field metrics (`min-width: 220px`,
   * `min-height: var(--control-md)`), measuring 220x38.
   */
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll("input[type='checkbox']")]
      .map((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return null;
        return {
          label:
            el.closest('label')?.innerText.replace(/\s+/g, ' ').trim() ??
            el.getAttribute('aria-label') ??
            '(unlabelled)',
          w: +r.width.toFixed(1),
          h: +r.height.toFixed(1),
        };
      })
      .filter(Boolean),
  );
  assert.ok(
    boxes.length >= 2,
    `expected several checkboxes, saw ${boxes.length}`,
  );
  for (const box of boxes) {
    assert.ok(
      box.w <= 20 && box.h <= 20,
      `checkbox "${box.label}" must be a normal size, measured ${box.w}x${box.h}`,
    );
    assert.ok(
      box.w >= 14 && box.h >= 14,
      `checkbox "${box.label}" must stay tappable, measured ${box.w}x${box.h}`,
    );
  }

  /** The 自动备份 row's controls: one gap size, one vertical centre. */
  const row = await page.evaluate(() => {
    const el = document.querySelector('.archive-settings .backup-controls');
    if (!el) return { error: 'no .backup-controls' };
    const kids = [...el.children].map((c) => {
      const r = c.getBoundingClientRect();
      return {
        text: c.innerText.replace(/\s+/g, ' ').trim().slice(0, 12),
        left: +r.left.toFixed(1),
        w: +r.width.toFixed(1),
        centre: +(r.top + r.height / 2).toFixed(1),
      };
    });
    const gaps = kids
      .slice(1)
      .map((k, i) => +(k.left - (kids[i].left + kids[i].w)).toFixed(1));
    const centres = kids.map((k) => k.centre);
    return {
      count: kids.length,
      gaps,
      spread: +(Math.max(...centres) - Math.min(...centres)).toFixed(1),
    };
  });
  assert.equal(row.error, undefined, `backup row: ${row.error}`);
  assert.equal(row.count, 4, 'the 自动备份 row keeps its four controls');
  assert.deepEqual(
    row.gaps,
    row.gaps.map(() => row.gaps[0]),
    `the row's gaps must be even, measured ${JSON.stringify(row.gaps)}`,
  );
  assert.ok(
    row.spread <= 1,
    `the row's controls must share a vertical centre, spread ${row.spread}px`,
  );

  /**
   * A control's icon and its label must share a line. `button` sets
   * `display: block`, and a lucide `<svg>` is block-level inside it, so the
   * absence of a row rule is invisible to every other kind of assertion. The
   * button lives on the observation page, so go there first.
   */
  await page.evaluate(() => {
    window.location.hash = '#/observation';
  });
  await page.waitForSelector('button:has(> svg)', { timeout: 15000 });

  const iconRow = (label) =>
    page.evaluate((labelText) => {
      const button = [...document.querySelectorAll('button')].find(
        (b) =>
          b.innerText.replace(/\s+/g, ' ').trim() === labelText &&
          b.querySelector('svg') &&
          b.getBoundingClientRect().width > 0,
      );
      if (!button) return { found: false };
      const sr = button.querySelector('svg').getBoundingClientRect();
      const textNodes = [];
      for (const node of button.childNodes) {
        if (node.nodeType === 3 && node.textContent.trim())
          textNodes.push(node);
      }
      if (!textNodes.length) return { found: true, noText: true };
      const range = document.createRange();
      range.setStartBefore(textNodes[0]);
      range.setEndAfter(textNodes[textNodes.length - 1]);
      const rects = [...range.getClientRects()].filter((r) => r.height > 0);
      const top = Math.min(...rects.map((r) => r.top));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      const br = button.getBoundingClientRect();
      return {
        found: true,
        display: getComputedStyle(button).display,
        // Vertically the two must overlap: they are on the same line.
        sameLine: !(sr.bottom <= top + 0.5 || sr.top >= bottom - 0.5),
        // Horizontally the icon must finish before the label starts.
        iconLeftOfText: sr.right <= Math.min(...rects.map((r) => r.left)) + 2,
        centreOffset: Math.abs(
          sr.top + sr.height / 2 - (br.top + br.height / 2),
        ),
      };
    }, label);

  const refresh = await iconRow('刷新观测');
  assert.equal(refresh.found, true, '刷新观测 must render as a button');
  assert.equal(
    refresh.sameLine,
    true,
    `刷新观测 icon must sit on the label's line, not above it (display: ${refresh.display})`,
  );
  assert.equal(
    refresh.iconLeftOfText,
    true,
    '刷新观测 icon must sit to the left of its label',
  );
  assert.ok(
    refresh.centreOffset <= 1,
    `刷新观测 icon must be vertically centred in the button, off by ${refresh.centreOffset.toFixed(
      1,
    )}px`,
  );

  /** Imports and increments must be the same colour family. */
  await page.evaluate(() => {
    window.location.hash = '#/timeline';
  });
  await page.waitForSelector('.event-initial_import .event-duration', {
    timeout: 15000,
  });
  const pills = await page.evaluate(() => {
    const read = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const s = getComputedStyle(el);
      return { color: s.color, background: s.backgroundColor };
    };
    // Resolve the token rather than hardcoding its hex, so a palette change does
    // not fail an assertion that is really about "both chips use one colour".
    const probe = document.createElement('span');
    probe.style.color = 'var(--success)';
    document.body.append(probe);
    const success = getComputedStyle(probe).color;
    probe.remove();
    return {
      import: read('.event-initial_import .event-duration'),
      increment: read('.event-increment .event-duration'),
      success,
    };
  });
  assert.ok(pills.import, 'an initial_import chip must render on the timeline');
  assert.ok(pills.increment, 'an increment chip must render on the timeline');
  assert.equal(
    pills.import.color,
    pills.increment.color,
    'an import chip and an increment chip must share one text colour',
  );
  assert.equal(
    pills.import.color,
    pills.success,
    'both chips must use --success, so neither is "one green and one not-green"',
  );

  const startup = await context.newPage();
  await startup.addInitScript((table) => {
    const old = window.__TAURI_INTERNALS__.invoke;
    let count = 0;
    window.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === 'load_library') {
        count++;
        if (count <= 2)
          return new Promise((resolve) => {
            window.__qa.resolveInitial = () =>
              resolve(structuredClone(table.load_library));
          });
        const current = structuredClone(table.load_library);
        current.report.instances[0].name = 'LATEST-ARCHIVE-WORLD';
        current.report.last_scan = '2026-09-18T12:00:00Z';
        return current;
      }
      return old(command, args);
    };
  }, backend);
  await startup.goto('http://127.0.0.1:1420/#/worlds');
  await startup
    .getByText('LATEST-ARCHIVE-WORLD', { exact: false })
    .first()
    .waitFor({ state: 'attached' });
  await startup.evaluate(() => window.__qa.resolveInitial());
  await startup.waitForTimeout(5400);
  assert.ok(
    (await startup
      .getByText('LATEST-ARCHIVE-WORLD', { exact: false })
      .count()) > 0,
  );
  console.log(
    'PASS: stale restore preview discarded, digest bound, cancel restore, failed preview cleared, file picker selection, cross-source startup race',
  );
} finally {
  await browser.close();
}
