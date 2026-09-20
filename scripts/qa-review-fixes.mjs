/* global window, document */
import { chromium } from 'playwright-core';
import { backend } from './qa-fixtures.mjs';
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
  await page.addInitScript(() => {
    const old = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === 'archive_status')
        return {
          version: '0.10.15',
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
  });
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
