// One-off probe: antd Collapse under the app's global reduced-motion reset -
// the panel content must become visible when a header is clicked (the design
// gate's expansion loop relies on this).
import { chromium } from 'playwright-core';
import { backend } from '../qa-fixtures.mjs';
import { installObservationFixture } from '../qa-observation-fixture.mjs';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  });
  await context.addInitScript(installObservationFixture, backend);
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:1420/#/settings');
  // The evidence Collapse lives inside a clone candidate card in 数据健康,
  // which sits inside the collapsed health-disclosure - open it first.
  await page.waitForSelector('.health-disclosure', { timeout: 30000 });
  await page.locator('.health-disclosure > summary').click();
  const evidence = page
    .locator('.clone-candidate .ant-collapse-header')
    .first();
  await evidence.waitFor({ state: 'visible', timeout: 30000 });
  await evidence.click();
  // Under the global reset (animation: none) the motion events antd waits for
  // never fire; the content must still end up visible for the reader.
  await page
    .waitForFunction(
      () => {
        const node = document.querySelector('.clone-evidence');
        if (!node) return false;
        const style = getComputedStyle(node);
        return (
          style.display !== 'none' && node.getBoundingClientRect().height > 0
        );
      },
      { timeout: 5000 },
    )
    .catch(() => {
      throw new Error('clone evidence content not visible after expanding');
    });
  console.log('PASS: antd Collapse expands under reduced motion');
} finally {
  await browser.close();
}
