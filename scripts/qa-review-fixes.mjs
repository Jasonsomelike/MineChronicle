/* global window, document, getComputedStyle */
import { chromium } from 'playwright-core';
import { backend, pagedBackend, APP_VERSION } from './qa-fixtures.mjs';
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

  /**
   * One control, two states.
   *
   * The pagination arrows are the clearest case: `‹` is disabled on page 1 and `›`
   * is not, and the disabled one kept `button`'s primary fill, so the row rendered
   * as a washed-out pale square beside a saturated dark-green square and read as
   * two different components. Both halves of that are pinned here: the two arrows
   * must be the same box, the same radius, the same font and the same border
   * width, and neither of them may wear `--surface-strong`.
   *
   * The reader is on `#/worlds`, where the shared `<Pagination>` renders fixed
   * 34x38 arrows, so "same box" is a meaningful assertion rather than a
   * coincidence of two labels happening to measure alike. That route needs the
   * paged fixture: the shared one has three worlds and no pager, and the other
   * routes' pages are fixtures-only too, so the assertion would have had nothing
   * to measure anywhere else.
   *
   * Every other disabled control in the app is checked against the same rule, so a
   * future `.something button:disabled { ... }` cannot reintroduce a second look.
   * These are geometry and state assertions: none of this is visible by reading
   * the CSS, which is how it shipped in the first place.
   */
  // A separate tab, and the init script goes on *it* rather than on the context:
  // a script added to a context after that context already has a live page does
  // not reach a new page's document, which is why this override never ran when it
  // was registered on `context` or on the already-navigated `page`.
  const pager = await context.newPage();
  await pager.addInitScript((table) => {
    window.__qaPaged = table;
    const original = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (command, args) =>
      command === 'load_library' && window.__qaPaged
        ? structuredClone(window.__qaPaged.load_library)
        : original(command, args);
  }, pagedBackend);
  await pager.goto('http://127.0.0.1:1420/#/worlds');
  await pager.waitForSelector('.pagination button', { timeout: 15000 });

  const arrows = await pager.evaluate(() => {
    const read = (b) => {
      const s = getComputedStyle(b);
      const r = b.getBoundingClientRect();
      return {
        label: b.getAttribute('aria-label'),
        disabled: b.disabled,
        w: +r.width.toFixed(1),
        h: +r.height.toFixed(1),
        radius: s.borderTopLeftRadius,
        font: s.fontSize,
        weight: s.fontWeight,
        display: s.display,
        border: s.borderTopWidth + ' ' + s.borderTopStyle,
        bg: s.backgroundColor.replace(/\s+/g, '').toLowerCase(),
        color: s.color.replace(/\s+/g, '').toLowerCase(),
        cursor: s.cursor,
        opacity: s.opacity,
        shadow: s.boxShadow,
      };
    };
    return [...document.querySelectorAll('.pagination button')].map(read);
  });
  assert.equal(arrows.length, 2, 'the pagination row has both arrows');
  const [prev, next] = arrows;
  assert.equal(prev.label, '上一页', 'the first arrow is 上一页');
  assert.equal(next.label, '下一页', 'the second arrow is 下一页');
  assert.equal(prev.disabled, true, '上一页 is disabled on page 1');
  assert.equal(
    next.disabled,
    false,
    '下一页 is enabled while the fixture has more than one page',
  );
  for (const field of ['w', 'h', 'radius', 'font', 'weight', 'display']) {
    assert.equal(
      prev[field],
      next[field],
      `the two arrows must be one control in two states, but ${field} differs: ` +
        `${prev[field]} (disabled) vs ${next[field]} (enabled)`,
    );
  }
  assert.notEqual(
    prev.bg,
    next.bg,
    'a disabled arrow must not share the enabled arrow’s fill',
  );
  assert.notEqual(
    prev.color,
    next.color,
    'a disabled arrow must not share the enabled arrow’s text colour',
  );
  assert.equal(
    prev.cursor,
    'not-allowed',
    `a disabled control must not claim the app is busy (cursor: ${prev.cursor})`,
  );
  assert.equal(
    next.opacity,
    '1',
    'the enabled arrow must not be faded: a faded control reads as disabled',
  );
  assert.notEqual(
    next.shadow,
    prev.shadow,
    'the usable arrow must be distinguishable from the spent one; both measured ' +
      `${next.shadow}`,
  );

  // Resolve the tokens rather than hardcoding hex, so a palette change does not
  // fail an assertion that is really about "not the primary fill".
  const strong = await pager.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue('--surface-strong')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ''),
  );
  assert.notEqual(
    next.bg,
    strong,
    'the enabled page-step arrow is tertiary navigation and must not wear the ' +
      'page’s primary-action fill (--surface-strong)',
  );
  assert.notEqual(
    prev.bg,
    strong,
    'the disabled page-step arrow must not wear the primary-action fill either',
  );

  /** The disabled label has to stay readable: >= 4.5:1 against its own fill. */
  const contrast = await pager.evaluate(() => {
    const parse = (value) => {
      const m = String(value).match(
        /(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)/,
      );
      return m ? [+m[1], +m[2], +m[3]] : null;
    };
    const lum = ([r, g, b]) => {
      const c = (x) => {
        x /= 255;
        return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
    };
    const bg = (el) => {
      let node = el;
      while (node) {
        const colour = getComputedStyle(node).backgroundColor;
        if (colour && !colour.includes('rgba(0, 0, 0, 0)')) return colour;
        node = node.parentElement;
      }
      return 'rgb(255, 255, 255)';
    };
    const out = {};
    for (const b of document.querySelectorAll('.pagination button')) {
      const s = getComputedStyle(b);
      const [hi, lo] = [lum(parse(s.color)), lum(parse(bg(b)))].sort(
        (x, y) => y - x,
      );
      out[b.getAttribute('aria-label')] = +((hi + 0.05) / (lo + 0.05)).toFixed(
        2,
      );
    }
    return out;
  });
  assert.ok(
    contrast['上一页'] >= 4.5,
    `a disabled label must still be readable, measured ${contrast['上一页']}:1`,
  );
  assert.ok(
    contrast['下一页'] >= 4.5,
    `the enabled label must be readable, measured ${contrast['下一页']}:1`,
  );

  /** The same rule, applied to every disabled control in the app. */
  await page.evaluate(() => {
    window.location.hash = '#/settings';
  });
  await page.waitForSelector('.settings-card', { timeout: 15000 });
  const pairs = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button:disabled')) {
      // Compare against a sibling control, not against a clone: appending a
      // clone after the original shifts `:first-of-type` on later matches.
      const sibling = [
        ...(el.parentElement?.querySelectorAll('button') ?? []),
      ].find((b) => !b.disabled);
      if (!sibling) continue;
      const a = getComputedStyle(el);
      const c = getComputedStyle(sibling);
      const ra = el.getBoundingClientRect();
      const rc = sibling.getBoundingClientRect();
      // Width is deliberately not compared: two controls with different labels
      // are legitimately different widths. Shape and height are not.
      out.push({
        text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 20) || '(icon)',
        statesMatch: [
          a.borderTopLeftRadius === c.borderTopLeftRadius,
          a.fontSize === c.fontSize,
          a.fontWeight === c.fontWeight,
          a.display === c.display,
          a.borderTopWidth === c.borderTopWidth,
          Math.abs(ra.height - rc.height) <= 0.5,
        ].every(Boolean),
        radius: a.borderTopLeftRadius,
        radiusPeer: c.borderTopLeftRadius,
        fontSize: a.fontSize,
        fontSizePeer: c.fontSize,
        bg: a.backgroundColor.replace(/\s+/g, '').toLowerCase(),
        bgPeer: c.backgroundColor.replace(/\s+/g, '').toLowerCase(),
        cursor: a.cursor,
      });
    }
    return out;
  });
  assert.ok(
    pairs.length >= 1,
    `expected at least one disabled control on the settings page, saw ${pairs.length}`,
  );
  for (const pair of pairs) {
    assert.equal(
      pair.statesMatch,
      true,
      `"${pair.text}" is styled as a second component rather than the same one ` +
        `disabled: radius ${pair.radius} vs ${pair.radiusPeer}, ` +
        `font ${pair.fontSize} vs ${pair.fontSizePeer}`,
    );
    assert.notEqual(
      pair.bg,
      pair.bgPeer,
      `"${pair.text}" is disabled but keeps an enabled sibling's fill ${pair.bg}`,
    );
    assert.equal(
      pair.cursor,
      'not-allowed',
      `"${pair.text}" is disabled but its cursor reads "${pair.cursor}"`,
    );
  }

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
