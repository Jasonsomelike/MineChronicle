// One-off probe for the visual-review findings:
//   1. timeline event filter Select vs the three activity pickers (both themes)
//   2. world row name/instance spacing on the worlds page (both themes)
// After the fix the probe asserts the repaired state: the pickers wear the
// outlined control .player-trigger declares (not the baseline's blue fill), and
// the world row's name/instance pair is separated by the header's column gap.
import { chromium } from 'playwright-core';
import { backend } from '../qa-fixtures.mjs';
import { installObservationFixture } from '../qa-observation-fixture.mjs';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:1420';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: 'reduce',
    });
    await context.addInitScript(installObservationFixture, backend);
    await context.addInitScript((value) => {
      localStorage.setItem('minechronicle.theme', value);
    }, theme);
    const page = await context.newPage();

    // --- finding 1: the timeline filter band -------------------------------
    await page.goto(`${BASE}/#/timeline`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.timeline-filters .ant-select', {
      timeout: 30000,
    });
    await page.waitForTimeout(400);
    const timeline = await page.evaluate(() => {
      const bg = (sel) => {
        const node = document.querySelector(sel);
        return node ? getComputedStyle(node).backgroundColor : null;
      };
      return {
        dataTheme: document.documentElement.dataset.theme,
        eventSelect: bg('.timeline-filters .ant-select'),
        playerTrigger: bg('.activity-filters .player-trigger'),
      };
    });
    console.log(`[${theme}] timeline:`, JSON.stringify(timeline));
    // The pickers must be the outlined control their own rule declares, never
    // the baseline's primary fill: --surface-raised in both themes.
    assert.equal(
      timeline.playerTrigger,
      theme === 'dark' ? 'rgb(42, 42, 43)' : 'rgb(255, 255, 255)',
      'player trigger must wear the outlined --surface-raised fill',
    );
    // The event Select keeps the library's own container token (dark algorithm
    // darkens it; light stays white) - it was never the defect.
    assert.equal(
      timeline.eventSelect,
      theme === 'dark' ? 'rgb(35, 35, 36)' : 'rgb(255, 255, 255)',
      'event select keeps the antd container background',
    );
    // Hover too: the picker's own --surface-hover, not the baseline's
    // --surface-strong-hover blue.
    await page.hover('.activity-filters .player-trigger');
    const hoverBg = await page.evaluate(
      () =>
        getComputedStyle(
          document.querySelector('.activity-filters .player-trigger'),
        ).backgroundColor,
    );
    console.log(`[${theme}] trigger hover bg:`, hoverBg);
    assert.equal(
      hoverBg,
      theme === 'dark' ? 'rgb(46, 46, 48)' : 'rgb(242, 243, 245)',
      'player trigger hover must use --surface-hover',
    );
    await page.locator('.timeline-filters').screenshot({
      path: `output/visual-accept/lib/_probe-filters-${theme}.png`,
    });

    // --- finding 2: the world rows -----------------------------------------
    await page.goto(`${BASE}/#/worlds`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.world-result', { timeout: 30000 });
    await page.waitForTimeout(400);
    const worlds = await page.evaluate(() => {
      const title = document.querySelector('.world-result .ant-collapse-title');
      const cs = title ? getComputedStyle(title) : null;
      const strong = title?.querySelector('strong');
      const instance = title?.querySelector('.world-instance');
      const a = strong?.getBoundingClientRect();
      const b = instance?.getBoundingClientRect();
      return {
        display: cs?.display,
        gap: cs?.gap,
        visualGapPx: a && b ? Math.round((b.left - a.right) * 10) / 10 : null,
        strongText: strong?.textContent,
        instanceText: instance?.textContent,
      };
    });
    console.log(`[${theme}] worlds:`, JSON.stringify(worlds));
    assert.equal(worlds.display, 'flex', 'row header must lay out as flex');
    assert.equal(worlds.gap, '8px 12px', 'row header must keep the token gap');
    assert.equal(
      worlds.visualGapPx,
      12,
      'world name and instance suffix must sit one column gap apart',
    );
    const firstRow = page.locator('.world-result').first();
    await firstRow.screenshot({
      path: `output/visual-accept/lib/_probe-world-${theme}.png`,
    });

    await context.close();
  }
} finally {
  await browser.close();
}
console.log('PASS: both review findings fixed on the live page');
