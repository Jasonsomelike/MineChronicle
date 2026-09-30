/* global window, document, localStorage, getComputedStyle */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { backend } from './qa-fixtures.mjs';

const output = 'output/ui-2026-09-29/verified';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const theme of ['light', 'dark']) {
    for (const width of [1080, 1280, 620]) {
      const context = await browser.newContext({
        viewport: { width, height: 760 },
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(
        ({ table, theme }) => {
          window.isTauri = true;
          window.__TAURI_INTERNALS__ = {
            transformCallback: (callback) => callback,
            invoke: async (command) => table[command] ?? null,
          };
          localStorage.setItem('minechronicle.theme', theme);
        },
        { table: backend, theme },
      );
      await page.goto('http://127.0.0.1:1420/#/dashboard');
      await page.locator('.overview-ranking').waitFor();
      await page.waitForTimeout(500);
      const layout = await page.evaluate(() => {
        const rect = (selector) => {
          const r = document.querySelector(selector).getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        };
        return {
          viewport: window.innerWidth,
          contentWidth: document.documentElement.scrollWidth,
          panel: rect('.overview-grid'),
          ranking: rect('.overview-ranking'),
          scale: rect('.ruler-scale'),
          switch: rect('.ranking-switch'),
          labels: [...document.querySelectorAll('.ruler-scale span')]
            .filter((element) => getComputedStyle(element).display !== 'none')
            .map((element) => ({
              width: element.getBoundingClientRect().width,
              height: element.getBoundingClientRect().height,
            })),
        };
      });
      assert.ok(layout.contentWidth <= layout.viewport, 'horizontal overflow');
      assert.ok(
        layout.switch.height <= 40,
        'segmented inherits form label spacing',
      );
      assert.ok(
        layout.ranking.width >= layout.panel.width - 3,
        'ranking must span panel',
      );
      assert.ok(
        layout.labels.every((label) => label.height <= 18),
        'scale label wraps',
      );
      assert.ok(
        layout.labels.reduce((sum, label) => sum + label.width, 0) <=
          layout.scale.width,
        'scale labels overlap',
      );
      await page.getByText('实例排行', { exact: true }).click();
      await page.locator('.ruler-name', { hasText: 'QA Instance' }).waitFor();
      await page.getByText('世界排行', { exact: true }).click();
      await page.locator('.ruler-name', { hasText: 'QA World' }).waitFor();
      await page.screenshot({
        path: `${output}/${theme}-${width}-dashboard.png`,
        fullPage: true,
      });
      await page.locator('.dashboard .player-trigger').click();
      await page.getByRole('button', { name: '清空', exact: true }).click();
      await page.getByRole('button', { name: '完成选择', exact: true }).click();
      await page.getByText('未选择玩家，无法统计', { exact: true }).waitFor();
      assert.equal(await page.locator('.overview-ranking').count(), 0);
      assert.equal(
        await page.locator('.career-copy > strong').textContent(),
        '—',
      );
      await page.getByRole('button', { name: '选择玩家', exact: true }).click();
      await page.getByRole('button', { name: '全选', exact: true }).click();
      await page.getByRole('button', { name: '完成选择', exact: true }).click();
      await page.locator('.overview-ranking').waitFor();
      await page.locator('.stats-method summary').click();
      assert.equal(
        await page.locator('.stats-method').getAttribute('open'),
        '',
      );
      await page
        .getByRole('button', { name: '查看数据健康', exact: true })
        .click();
      await page.locator('.settings-layout').waitFor();
      await page.screenshot({
        path: `${output}/${theme}-${width}-settings.png`,
        fullPage: true,
      });
      assert.deepEqual(errors, [], 'browser errors');
      console.log(
        `${theme}/${width}: layout, ranking switch, disclosure, settings navigation passed`,
      );
      await context.close();
    }
  }
} finally {
  await browser.close();
}
