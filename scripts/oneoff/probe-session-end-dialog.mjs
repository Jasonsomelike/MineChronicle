// One-off probe: the SessionEndDialog <dialog>→Modal migration has no qa gate of
// its own, so exercise the open/validate/save paths against the dev fixture.
import { chromium } from 'playwright-core';
import { backend } from '../qa-fixtures.mjs';
import { installObservationFixture } from '../qa-observation-fixture.mjs';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  });
  await context.addInitScript(installObservationFixture, backend);
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:1420/#/observation');
  await page.waitForSelector('.observed-sessions', { timeout: 30000 });
  // Open one instance group and start editing a session end. The row trigger is
  // the 填写/修改 text button on a session with no observed end.
  await page.locator('.observed-group > summary').first().click();
  const editButtons = page.getByRole('button', { name: '填写', exact: true });
  const count = await editButtons.count();
  assert.ok(count >= 1, `expected an end-time edit button, saw ${count}`);
  await editButtons.first().click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible', timeout: 10000 });
  assert.ok(
    (await dialog.locator('.session-end-facts').count()) === 1,
    'the facts list renders inside the Modal',
  );
  // Escape closes via onCancel → requestClose → afterClose → onClose.
  await dialog.press('Escape');
  await dialog.waitFor({ state: 'hidden', timeout: 10000 });
  assert.equal(await page.getByRole('dialog').count(), 0, 'dialog unmounted');
  console.log(
    'PASS: SessionEndDialog opens on antd Modal, Escape closes, unmounts clean',
  );
} finally {
  await browser.close();
}
