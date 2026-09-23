/* global window, document */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { backend } from './qa-fixtures.mjs';
import { installObservationFixture } from './qa-observation-fixture.mjs';

/**
 * Poll a locator's rendered text against a pattern.
 *
 * `playwright-core` ships no `expect`, and the built-in `assert` cannot poll. The
 * groups are collapsed when this is used, so a visibility-filtered locator would
 * never resolve: `textContent` is read directly instead.
 */
async function waitText(locator, pattern, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let seen = '';
  for (;;) {
    seen = (await locator.textContent()) ?? '';
    if (pattern.test(seen)) return seen;
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for ${pattern}; last text: ${seen}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const out = 'output/playwright/observation-fixes';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1720, height: 1000 },
    reducedMotion: 'reduce',
  });
  await context.addInitScript(installObservationFixture, backend);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:1420/#/observation');
  // Each instance's pager lives inside its own `<details>`, and the groups start
  // collapsed, so its text is in the DOM but nothing is rendered. `innerText` and
  // `getByRole(..., { visible: true })` both see an empty element there, which
  // would make these assertions fail for a reason unrelated to pagination.
  // `textContent` reads the pager the component produced, collapsed or not.
  const group = (name) =>
    page.locator('.observed-group').filter({ hasText: name });
  const groupPager = (name) =>
    group(name).locator('.observation-group-pagination');
  const pagerText = (name) => groupPager(name).locator('span');
  // Pagination is per instance, so the two pagers must disagree about their page
  // count: `D:\QA\root` holds 36 of the fixture's 51 records over 2 pages and
  // `D:\QA\server` holds 15 over 1. A shared cursor cannot produce both.
  await waitText(pagerText('QA Instance'), /第 1 \/ 2 页 · 共 36 条/);
  await waitText(pagerText('香草纪元：食旅纪行'), /第 1 \/ 1 页 · 共 15 条/);

  // Groups start collapsed, so a row's text is present in the DOM but not rendered
  // and `innerText` returns only the summaries. Opening the group first is both
  // what a user does and what makes the row text readable.
  const openGroups = async () => {
    await page.evaluate(() => {
      document
        .querySelectorAll('.observed-group:not([open])')
        .forEach((group) => group.setAttribute('open', ''));
    });
  };

  // Collapsed by default, so the list reads as one line per instance. Pinned
  // because the row assertions below depend on opening them first.
  assert.equal(
    await page.locator('.observed-group[open]').count(),
    0,
    'instance groups must start collapsed',
  );
  // Collapsed groups hold the first page of each instance: 20 for `D:\QA\root`
  // and all 15 for `D:\QA\server`. The list used to show 20 rows in total because
  // one global page sliced across both instances.
  assert.equal(
    await page.locator('.observed-sessions tbody tr').count(),
    35,
    'collapsed groups keep each instance first page in the DOM',
  );
  // The assertion this replaces read `pagination (51 rows)` and drove a single
  // list-wide pager. No list-level pager exists any more: one control over every
  // instance could only describe instances the reader was not looking at.
  assert.equal(
    await page.locator('.observed-sessions > .observation-pagination').count(),
    0,
    'no list-level pager remains',
  );
  // The newest fixture record is a live session, so it has no measurable duration
  // and contributes 0. That is why the page subtotals are 48m/17m rather than
  // 49m/18m. The summary's own figures come from the fixture's fixed values, so this
  // asserts the page subtotal, which is computed from the rows.
  //
  // Units are the compact `48m 0s` form. The wording was `48 分钟` until the duration
  // formatter changed; these assertions were left behind and the suite was red.
  assert.match(
    await page.locator('.observation-summary').innerText(),
    /48m 0s/,
  );
  assert.match(
    await page.locator('.observation-summary').innerText(),
    /17m 0s/,
  );
  // A live session must be renderable: it shows as running and waits for the
  // instance to close, rather than presenting an invented end time.
  await openGroups();
  assert.match(await page.locator('.observed-sessions').innerText(), /运行中/);
  assert.match(
    await page.locator('.observed-sessions').innerText(),
    /等待实例关闭/,
  );
  await openGroups();
  assert.match(
    await page.locator('.observed-sessions').innerText(),
    /缺少本地基线/,
  );
  // A collapsible group is uncontrolled and does not close when its own rows are
  // re-read, so the opened groups stay open across the paging below.
  assert.equal(
    await groupPager('QA Instance')
      .getByRole('button', { name: '上一页', exact: true })
      .isDisabled(),
    true,
  );
  // One page of records does not get a working 下一页: the button is disabled
  // rather than hidden, so the control does not move under the pointer.
  assert.equal(
    await groupPager('香草纪元：食旅纪行')
      .getByRole('button', { name: '下一页', exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page.locator('.observation-explanation').getAttribute('open'),
    null,
  );
  await page.screenshot({ path: `${out}/wide.png`, fullPage: true });

  // Paging one instance must not move the other. The failing read is keyed on the
  // instance page, so this is `D:\QA\root`'s page 2 failing.
  await page.evaluate(() => {
    window.__qa.failObservationPage = 2;
  });
  await groupPager('QA Instance')
    .getByRole('button', { name: '下一页', exact: true })
    .click();
  await page
    .getByRole('alert')
    .filter({ hasText: 'QA temporary observation failure' })
    .waitFor();
  assert.equal(
    await page.locator('.observed-sessions tbody tr').count(),
    35,
    'preserve last successful page on failure',
  );
  await page.evaluate(() => {
    window.__qa.failObservationPage = 0;
  });
  await page.getByRole('button', { name: '立即重试', exact: true }).click();
  await waitText(pagerText('QA Instance'), /第 2 \/ 2 页 · 共 36 条/);
  // `D:\QA\server` was never paged, so it still shows its first page. Without this
  // the suite would pass with a single shared cursor.
  await waitText(pagerText('香草纪元：食旅纪行'), /第 1 \/ 1 页 · 共 15 条/);
  // 15 rows for the untouched instance plus the 16 that remain on `D:\QA\root`'s
  // second page. The list used to total 11 here, because a single pager sliced all
  // 51 records and its last page held only the tail. 31 rather than 36 is the
  // point: `D:\QA\root` lost no rows it should have kept and gained none from
  // `D:\QA\server`, which is still showing its whole first page.
  assert.equal(await page.locator('.observed-sessions tbody tr').count(), 31);
  // id 1 is the oldest record and belongs to `D:\QA\root`, so it is the last row
  // of that instance's last page. Identified by time because the instance name
  // heads a group rather than labelling each row.
  assert.match(await group('QA Instance').innerText(), /08:01:00/);
  // The older instance's rows are still there; its newest record (id 37, 00:37)
  // must not have been dragged onto `D:\QA\root`'s second page.
  await openGroups();
  assert.equal(
    await groupPager('QA Instance')
      .getByRole('button', { name: '下一页', exact: true })
      .isDisabled(),
    true,
  );
  // The summary's 「本页」 is the payload's first page and did not move, because
  // only `D:\QA\root` was paged. This assertion replaces one that read /11m 0s/:
  // that figure came from the list-wide pager's last page reaching the summary,
  // and with per-instance pagers there is no list-wide page left for it to track.
  // It is the clearest evidence that a group pager is scoped to its group.
  assert.match(
    await page.locator('.observation-summary').innerText(),
    /48m 0s/,
  );
  assert.match(
    await page.locator('.observation-summary').innerText(),
    /17m 0s/,
  );
  assert.doesNotMatch(
    await page.locator('.observation-summary').innerText(),
    /11m 0s/,
  );

  await page.setViewportSize({ width: 620, height: 900 });
  await page.getByText('如何计算这些时间', { exact: true }).click();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: `${out}/narrow.png`, fullPage: true });
  const sizes = await page.evaluate(() => {
    const scroller = document.querySelector('.observed-sessions-scroll');
    return {
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
      tableHeight: scroller.clientHeight,
      tableScroll: scroller.scrollHeight,
    };
  });
  assert.ok(sizes.scroll <= sizes.width + 1, 'no document horizontal overflow');
  assert.ok(
    sizes.tableScroll <= sizes.tableHeight + 1,
    'no nested vertical table scrolling',
  );
  await page.setViewportSize({ width: 1720, height: 1000 });
  await page.getByRole('button', { name: '生涯概览', exact: true }).click();
  await page
    .getByText('全部实例历史累计，不随玩家筛选。', { exact: false })
    .waitFor();
  const instanceSummary = page
    .locator('.health-summary p')
    .filter({ hasText: '未归因运行时长' });
  const before = await instanceSummary.innerText();
  await page
    .getByRole('button', { name: /^统计玩家：/ })
    .first()
    .click();
  await page.getByRole('button', { name: '清空', exact: true }).click();
  await page.keyboard.press('Escape');
  assert.equal(await instanceSummary.innerText(), before);
  await page.getByRole('button', { name: '查看实例观测', exact: true }).click();
  // The observation page is kept mounted while it is hidden, so the round trip
  // does not reset paging: `D:\QA\root` is still where the reader left it, on its
  // own page 2. This assertion used to expect the list-wide pager to be sitting on
  // page 3, which was the same "state survived" fact expressed against a control
  // that no longer exists. What matters is that an instance's pager survives a
  // page switch without following any other instance.
  await waitText(pagerText('QA Instance'), /第 2 \/ 2 页 · 共 36 条/);
  await waitText(pagerText('香草纪元：食旅纪行'), /第 1 \/ 1 页 · 共 15 条/);

  // Real ScanPanel effects, unchanged revisions, and both library channels
  // failing: the next successful poll must actually retry the library.
  const retryPage = await context.newPage();
  await retryPage.addInitScript(() => {
    window.__qa.failLibrary = true;
  });
  await retryPage.goto('http://127.0.0.1:1420/#/dashboard');
  await retryPage.waitForFunction(() => window.__qa.libraryCalls >= 3);
  const calls = await retryPage.evaluate(() => {
    const n = window.__qa.libraryCalls;
    window.__qa.failLibrary = false;
    return n;
  });
  await retryPage.waitForFunction((n) => window.__qa.libraryCalls > n, calls);
  await retryPage
    .getByRole('button', { name: /^统计玩家：/ })
    .first()
    .waitFor();
  await retryPage.waitForFunction(
    () => !document.body.innerText.includes('QA temporary library failure'),
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: per-instance pagination (51 rows, 36 over 2 pages + 15 over 1, independent cursors), stable lifetime totals, baseline/unknown states, failed-instance-page retry, wide/narrow overflow, player scope, unchanged-revision recovery',
  );
} finally {
  await browser.close();
}
