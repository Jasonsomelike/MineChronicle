/* global document */
/**
 * Per-instance pagination, measured at the width the user actually runs.
 *
 * The user's window is ~2048 logical pixels (their screenshots are 1.24x), so
 * measuring at 1440 sits exactly on the content cap and hides width problems.
 * This measures rather than eyeballs: which pagers exist, how wide they are, where
 * they sit against their group, and whether the whole list still fits the page.
 *
 * Asserts, so it is a check and not just a print:
 *   - no list-level pager remains;
 *   - every group carries exactly one pager;
 *   - each pager's page count equals ceil(its own record_count / page_size), which
 *     is what makes it per-instance rather than shared;
 *   - a group's pager sits inside that group and within its horizontal bounds;
 *   - no document-level horizontal overflow at 2048 or at 620.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { backend } from './qa-fixtures.mjs';
import { installObservationFixture } from './qa-observation-fixture.mjs';

const OUT = 'output/playwright/observation-2048';
const WIDTH = 2048;
const HEIGHT = 1150;
// Matches the component's own page size; the fixture's groups are built with it.
const PAGE_SIZE = 20;
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    reducedMotion: 'reduce',
  });
  await context.addInitScript(installObservationFixture, backend);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:1420/#/observation');
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    document
      .querySelectorAll('.observed-group:not([open])')
      .forEach((group) => group.setAttribute('open', ''));
  });
  // Open groups only reveal their first page, so measure with one moved too: a
  // pager that never changes is indistinguishable from a dead control.
  await page
    .locator('.observed-group')
    .filter({ hasText: 'QA Instance' })
    .getByRole('button', { name: '下一页', exact: true })
    .click();
  await page.waitForTimeout(1200);

  const measured = await page.evaluate(() => {
    const flat = (node) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const groups = [...document.querySelectorAll('.observed-group')].map(
      (group) => {
        const pager = group.querySelector('.observation-group-pagination');
        const box = pager?.getBoundingClientRect();
        const groupBox = group.getBoundingClientRect();
        const rows = group.querySelectorAll('tbody tr').length;
        const text = flat(pager?.querySelector('span'));
        const numbers = text.match(/第 (\d+) \/ (\d+) 页 · 共 (\d+) 条/);
        return {
          name: flat(group.querySelector('summary strong')),
          rows,
          pagerText: text,
          page: numbers ? Number(numbers[1]) : null,
          pageCount: numbers ? Number(numbers[2]) : null,
          recordCount: numbers ? Number(numbers[3]) : null,
          pagerWidth: box ? Math.round(box.width) : null,
          pagerLeft: box ? Math.round(box.left) : null,
          pagerRight: box ? Math.round(box.right) : null,
          groupLeft: Math.round(groupBox.left),
          groupRight: Math.round(groupBox.right),
          rowWidth: Math.round(
            group.querySelector('table')?.getBoundingClientRect().width ?? 0,
          ),
          // The pager hugs its own table rather than the viewport, so its right
          // edge should track the table's, not the window's.
          pagerRightVsTableRight:
            box && group.querySelector('table')
              ? Math.round(
                  group.querySelector('table').getBoundingClientRect().right -
                    box.right,
                )
              : null,
        };
      },
    );
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      listPagerCount: document.querySelectorAll(
        '.observed-sessions > .observation-pagination',
      ).length,
      summary: flat(document.querySelector('.observation-summary')),
      groups,
    };
  });
  console.log(JSON.stringify(measured, null, 2));

  // One pager per instance, and none for the list.
  assert.equal(measured.listPagerCount, 0, 'no list-level pager at 2048');
  assert.equal(measured.groups.length, 2, 'both instances present');
  for (const group of measured.groups) {
    assert.equal(group.pageCount, Math.ceil(group.recordCount / PAGE_SIZE));
    assert.ok(group.page >= 1 && group.page <= group.pageCount);
    assert.ok(
      group.pagerLeft >= group.groupLeft &&
        group.pagerRight <= group.groupRight,
      `${group.name}'s pager stays inside its own group`,
    );
  }
  // The two pagers disagreeing about the page count is the whole change.
  assert.notEqual(
    measured.groups[0].pageCount,
    measured.groups[1].pageCount,
    'the two instances must not share a page count',
  );
  assert.equal(measured.groups[0].page, 2, 'the paged instance moved');
  assert.equal(measured.groups[1].page, 1, 'the untouched instance did not');
  assert.ok(
    measured.scrollWidth <= measured.clientWidth + 1,
    'no horizontal overflow at 2048',
  );
  await page.screenshot({ path: `${OUT}/paged-2048.png`, fullPage: true });

  await page.setViewportSize({ width: 620, height: 900 });
  await page.waitForTimeout(400);
  const narrow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(
    narrow.scrollWidth <= narrow.clientWidth + 1,
    'no horizontal overflow at 620',
  );
  assert.deepEqual(errors, []);
  console.log(
    `PASS: per-instance pagers measured at ${WIDTH}px (${measured.groups
      .map((g) => `${g.name} ${g.page}/${g.pageCount} of ${g.recordCount}`)
      .join('; ')}), no list pager, no overflow at ${WIDTH} or 620`,
  );
} finally {
  await browser.close();
}
