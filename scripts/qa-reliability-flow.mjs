/* global window, document */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { backend } from './qa-fixtures.mjs';
import { installObservationFixture } from './qa-observation-fixture.mjs';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
fs.mkdirSync('output/playwright/reliability', { recursive: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  });
  await context.addInitScript(installObservationFixture, backend);
  await context.addInitScript((table) => {
    const original = window.__TAURI_INTERNALS__.invoke;
    Object.assign(window.__qa, {
      failTotals: 0,
      failHealth: 0,
      failRuntime: false,
      failStatistics: false,
      blockRestore: false,
      counts: {},
      pending: false,
    });
    const policy = {
      enabled: true,
      retention: 7,
      directory: 'D:\\QA\\backups',
      last_day: '',
      error: '',
      records: [],
    };
    const backup = {
      path: 'D:\\QA\\backups\\manual.sqlite3',
      created_at: '2026-09-18T10:00:00Z',
      kind: 'manual',
      bytes: 1024,
      worlds: 3,
      observations: 51,
      schema: 7,
      digest: 'qa',
    };
    window.__TAURI_INTERNALS__.invoke = async (command, args) => {
      const q = window.__qa;
      q.counts[command] = (q.counts[command] ?? 0) + 1;
      if (command === 'runtime_info' && q.failRuntime)
        throw Error('QA runtime failure');
      if (command === 'tracking_summary' && q.failTotals-- > 0)
        throw Error('QA totals failure');
      if (command === 'health_summary' && q.failHealth-- > 0)
        throw Error('QA health failure');
      if (command === 'statistics') {
        if (q.failStatistics) throw Error('QA statistics failure');
        if (args.filter.query === 'slow')
          return new Promise((resolve) => {
            q.resolveSlow = () => resolve({ ...table.statistics, rows: [] });
          });
      }
      if (command === 'archive_status')
        return {
          database_path: 'D:\\QA\\archive.sqlite3',
          // Read from the shared fixture so it tracks package.json; a literal
          // here goes stale on every release and makes runtime_info look like a
          // version mismatch.
          version: table.runtime_info.version,
          policy,
          pending_restore: q.pending,
        };
      if (command === 'configure_backups') {
        Object.assign(policy, args);
        return policy;
      }
      if (command === 'create_archive_backup') {
        policy.records.push(backup);
        return backup;
      }
      if (command === 'inspect_archive_backup') {
        if (args.path === 'bad') throw Error('QA damaged archive');
        return backup;
      }
      if (command === 'schedule_archive_restore') {
        if (q.blockRestore) throw Error('游戏正在运行');
        q.pending = true;
        return;
      }
      if (command === 'restart_after_restore') {
        q.restarted = true;
        return;
      }
      if (command === 'open_archive_folder') return;
      return original(command, args);
    };
  }, backend);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:1420/#/observation');
  await page.getByRole('status').filter({ hasText: '第 1 / 3 页' }).waitFor();
  const before = await page.evaluate(
    () => window.__qa.counts.observed_sessions_page,
  );
  await page.waitForTimeout(3400);
  assert.equal(
    await page.evaluate(() => window.__qa.counts.observed_sessions_page),
    before,
    'unchanged revision skips attribution',
  );
  await page.evaluate(() => {
    window.__qa.rows.unshift({
      ...window.__qa.rows[0],
      id: 52,
      instance_name: 'NEW',
    });
    window.__qa.revision++;
  });
  await page.getByRole('button', { name: /有 1 条新观测/ }).waitFor();
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '第 2 / 3 页' }).waitFor();
  // Groups start collapsed, so the rows' text is in the DOM but not rendered and
  // `innerText` would return only the summaries. Open them before reading rows.
  await page.evaluate(() => {
    document
      .querySelectorAll('.observed-group:not([open])')
      .forEach((group) => group.setAttribute('open', ''));
  });
  // Rows are identified by their start time now that the instance name heads a
  // group instead of appearing on every row. id 32 is the last record of page 1 and
  // id 31 the first of page 2, so their timestamps (00:32 and 00:31) mark the
  // boundary without depending on the instance name.
  assert.match(
    await page.locator('.observed-sessions').innerText(),
    /08:31:00/,
  );
  assert.doesNotMatch(
    await page.locator('.observed-sessions').innerText(),
    /08:32:00/,
  );
  // The filters live in a drawer that is collapsed while nothing is filtering, so
  // open it before reaching for a control inside it - the same first step a user
  // takes. The summary states "未筛选" while collapsed, which the next assertion
  // relies on.
  await page.locator('.filter-drawer > summary').click();
  await page.getByLabel('状态', { exact: true }).selectOption('interrupted');
  await page.getByRole('status').filter({ hasText: '共 1 条' }).waitFor();

  await page.evaluate(() => {
    window.__qa.failTotals = 1;
    window.__qa.failHealth = 1;
    window.__qa.revision++;
  });
  await page.getByRole('button', { name: '生涯概览', exact: true }).click();
  await page
    .getByRole('alert')
    .filter({ hasText: 'QA totals failure' })
    .waitFor();
  await page
    .getByRole('alert')
    .filter({ hasText: 'QA totals failure' })
    .waitFor({ state: 'hidden', timeout: 15000 });
  await page
    .getByRole('alert')
    .filter({ hasText: 'QA health failure' })
    .waitFor({ state: 'hidden', timeout: 15000 });

  await page.getByRole('button', { name: '更多统计', exact: true }).click();
  await page.locator('.statistics tbody tr').first().waitFor();
  const search = page.getByLabel('搜索统计分类或键');
  await search.fill('slow');
  await page.waitForFunction(() => !!window.__qa.resolveSlow);
  await search.fill('');
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__qa.resolveSlow());
  await page.waitForTimeout(100);
  assert.ok(
    (await page.locator('.statistics tbody tr').count()) > 0,
    'obsolete request cannot replace current data',
  );
  await page.evaluate(() => {
    window.__qa.failStatistics = true;
  });
  await search.fill('failure');
  await page
    .getByRole('alert')
    .filter({ hasText: 'QA statistics failure' })
    .waitFor();
  assert.ok(
    (await page.locator('.statistics tbody tr').count()) > 0,
    'last successful rows remain visible',
  );
  await page.evaluate(() => {
    window.__qa.failStatistics = false;
  });
  await page.getByRole('button', { name: '立即重试', exact: true }).click();
  await page
    .getByRole('alert')
    .filter({ hasText: 'QA statistics failure' })
    .waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '清除本页筛选', exact: true }).click();
  assert.equal(await search.inputValue(), '');

  await page.getByRole('button', { name: '导入与设置', exact: true }).click();
  const archive = page.locator('#settings-archive');
  await archive.getByRole('switch').focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(
    () =>
      document.querySelector('#settings-archive input[role="switch"]')
        .checked === false,
  );
  await page.waitForTimeout(100);
  await archive.getByRole('switch').focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(
    () =>
      document.querySelector('#settings-archive input[role="switch"]')
        .checked === true,
  );

  await archive.getByRole('button', { name: '立即备份', exact: true }).click();
  await archive.getByText('手动备份已保存', { exact: true }).waitFor();
  await archive.getByLabel('保留自动备份').selectOption('14');
  await archive.getByText('选择备份并恢复', { exact: true }).click();
  const path = archive.getByLabel('或输入备份文件完整路径');
  await path.fill('bad');
  await archive.getByRole('button', { name: '校验并预览' }).click();
  await archive
    .getByRole('alert')
    .filter({ hasText: 'QA damaged archive' })
    .waitFor();
  await path.fill('D:\\QA\\backups\\manual.sqlite3');
  await archive.getByRole('button', { name: '校验并预览' }).click();
  await archive.getByLabel('我已确认要恢复这份档案').check();
  await page.evaluate(() => {
    window.__qa.blockRestore = true;
  });
  await archive.getByRole('button', { name: '备份当前档案并准备恢复' }).click();
  await archive
    .getByRole('alert')
    .filter({ hasText: '游戏正在运行' })
    .waitFor();
  assert.equal(await page.evaluate(() => window.__qa.pending), false);
  await page.evaluate(() => {
    window.__qa.blockRestore = false;
  });
  await archive.getByRole('button', { name: '备份当前档案并准备恢复' }).click();
  await archive.getByRole('button', { name: '重启并完成恢复' }).click();
  assert.equal(await page.evaluate(() => window.__qa.restarted), true);

  for (const [name, width, zoom] of [
    ['wide', 1280, 1],
    ['narrow', 620, 1],
    ['zoom', 1280, 1.5],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((z) => {
      document.documentElement.style.zoom = String(z);
    }, zoom);
    assert.ok(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1,
      ),
      'no document horizontal overflow',
    );
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({
      path: `output/playwright/reliability/${name}.png`,
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  const startup = await context.newPage();
  await startup.addInitScript(() => {
    window.__qa.failLibrary = true;
    window.__qa.failRuntime = true;
  });
  await startup.goto('http://127.0.0.1:1420/#/settings');
  await startup
    .getByLabel('搜索目录', { exact: false })
    .fill('D:\\QA\\user-edited');
  await startup.evaluate(() => {
    window.__qa.failLibrary = false;
    window.__qa.failRuntime = false;
  });
  await startup
    .getByText('当前档案位置', { exact: true })
    .waitFor({ timeout: 15000 });
  await startup.getByText('当前档案位置', { exact: true }).click();
  await startup
    .getByText('当前档案：D:\\QA\\archive.sqlite3', { exact: true })
    .waitFor();
  assert.equal(
    await startup.getByLabel('搜索目录', { exact: false }).inputValue(),
    'D:\\QA\\user-edited',
  );
  // Virtual time makes retry delays and visibility suspension deterministic.
  const retryPage = await context.newPage();
  await retryPage.addInitScript(() => {
    window.__qa.failTotals = 100;
    window.__qa.hidden = false;
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => window.__qa.hidden,
    });
  });
  await retryPage.clock.install();
  await retryPage.clock.pauseAt(new Date());
  await retryPage.goto('http://127.0.0.1:1420/#/dashboard');
  await retryPage
    .getByRole('alert')
    .filter({ hasText: 'QA totals failure' })
    .waitFor();
  await retryPage.clock.runFor(100);
  let count = await retryPage.evaluate(
    () => window.__qa.counts.tracking_summary,
  );
  await retryPage.clock.runFor(2800);
  assert.equal(
    await retryPage.evaluate(() => window.__qa.counts.tracking_summary),
    count,
  );
  await retryPage.clock.runFor(200);
  assert.equal(
    await retryPage.evaluate(() => window.__qa.counts.tracking_summary),
    count + 1,
  );
  count++;
  await retryPage.clock.runFor(9800);
  assert.equal(
    await retryPage.evaluate(() => window.__qa.counts.tracking_summary),
    count,
  );
  await retryPage.clock.runFor(200);
  assert.equal(
    await retryPage.evaluate(() => window.__qa.counts.tracking_summary),
    count + 1,
  );
  count++;
  await retryPage.clock.runFor(29800);
  assert.equal(
    await retryPage.evaluate(() => window.__qa.counts.tracking_summary),
    count,
  );
  await retryPage.clock.runFor(200);
  assert.equal(
    await retryPage.evaluate(() => window.__qa.counts.tracking_summary),
    count + 1,
  );
  count++;
  await retryPage.evaluate(() => {
    window.__qa.hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await retryPage.clock.runFor(60000);
  assert.equal(
    await retryPage.evaluate(() => window.__qa.counts.tracking_summary),
    count,
    'hidden window pauses retries',
  );
  await retryPage.evaluate(() => {
    window.__qa.failTotals = 0;
    window.__qa.hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await retryPage
    .getByRole('alert')
    .filter({ hasText: 'QA totals failure' })
    .waitFor({ state: 'hidden' });
  assert.equal(
    await retryPage.evaluate(() => window.__qa.counts.tracking_summary),
    count + 1,
  );
  await retryPage.close();
  console.log(
    'PASS: revision gating, stable pages, filters, transient recovery, stale request protection, retained rows, archive UI, blocked restore, startup input protection, wide/narrow/zoom',
  );
} finally {
  await browser.close();
}
