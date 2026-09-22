/* global window, document */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { backend } from './qa-fixtures.mjs';
import { installObservationFixture } from './qa-observation-fixture.mjs';

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
  await page.getByRole('status').filter({ hasText: '第 1 / 3 页' }).waitFor();

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
  assert.equal(
    await page.locator('.observed-sessions tbody tr').count(),
    20,
    'collapsed groups still keep their rows in the DOM',
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
  assert.equal(
    await page
      .getByRole('button', { name: '上一页', exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page.locator('.observation-explanation').getAttribute('open'),
    null,
  );
  await page.screenshot({ path: `${out}/wide.png`, fullPage: true });

  await page.evaluate(() => {
    window.__qa.failObservationPage = 2;
  });
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page
    .getByRole('alert')
    .filter({ hasText: 'QA temporary observation failure' })
    .waitFor();
  assert.equal(
    await page.locator('.observed-sessions tbody tr').count(),
    20,
    'preserve last successful page on failure',
  );
  await page.evaluate(() => {
    window.__qa.failObservationPage = 0;
  });
  await page.getByRole('button', { name: '立即重试', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '第 2 / 3 页' }).waitFor();
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '第 3 / 3 页' }).waitFor();
  assert.equal(await page.locator('.observed-sessions tbody tr').count(), 11);
  await openGroups();
  // id 1 is the oldest record, so it lands on the last page. Identified by time
  // because the instance name now heads a group rather than labelling each row.
  assert.match(
    await page.locator('.observed-sessions').innerText(),
    /08:01:00/,
  );
  assert.equal(
    await page
      .getByRole('button', { name: '下一页', exact: true })
      .isDisabled(),
    true,
  );
  assert.match(
    await page.locator('.observation-summary').innerText(),
    /48m 0s/,
  );
  assert.match(
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
  await page.getByRole('status').filter({ hasText: '第 3 / 3 页' }).waitFor();

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
    'PASS: pagination (51 rows), stable lifetime totals, baseline/unknown states, failed-page retry, wide/narrow overflow, player scope, unchanged-revision recovery',
  );
} finally {
  await browser.close();
}
