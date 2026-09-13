import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const origin = 'http://127.0.0.1:1420';
const server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1'], {
  cwd: process.cwd(),
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env,
});
let ready = false;
server.stdout.on('data', (chunk) => {
  const text = String(chunk);
  process.stdout.write(text);
  if (text.includes('Local:') || text.includes('ready in')) ready = true;
});
server.stderr.on('data', (chunk) => process.stderr.write(String(chunk)));

for (let i = 0; i < 120 && !ready; i += 1) await delay(500);
// Extra wait for optimizer after first "ready".
await delay(2000);

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});

try {
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);
  const result = await page.evaluate(async () => {
    const { animateDiscoveredStatIcons, prefersReducedMotion } = await import(
      '/src/lib/statIconMotion.ts'
    );
    const row = document.createElement('tr');
    row.dataset.statId = 'minecraft:used:example:gsap_probe';
    const cell = document.createElement('td');
    const sprite = document.createElement('img');
    sprite.className = 'stat-sprite';
    sprite.src = '/stat-fallback.svg';
    cell.appendChild(sprite);
    row.appendChild(cell);
    document.body.appendChild(row);
    const before = getComputedStyle(sprite).opacity;
    const timeline = animateDiscoveredStatIcons(
      ['minecraft:used:example:gsap_probe'],
      document,
      { matches: false },
    );
    if (!timeline) {
      return {
        ok: false,
        reason: 'timeline-null',
        reduced: prefersReducedMotion({ matches: false }),
      };
    }
    await new Promise((resolve) => timeline.eventCallback('onComplete', resolve));
    const after = getComputedStyle(sprite).opacity;
    const transform = getComputedStyle(sprite).transform;
    return {
      ok: true,
      before,
      after,
      transform,
      reducedFalse: prefersReducedMotion({ matches: false }),
      reducedTrue: prefersReducedMotion({ matches: true }),
      skipped: animateDiscoveredStatIcons(
        ['minecraft:used:example:gsap_probe'],
        document,
        { matches: true },
      ),
    };
  });
  console.log('GSAP_PROBE', JSON.stringify(result));
  await page.screenshot({ path: 'output/playwright/gsap-stat-icon-probe.png', fullPage: false });
  if (!result.ok || String(result.after) !== '1' || result.reducedTrue !== true) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error('GSAP_PROBE_FAIL', error);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill('SIGTERM');
}
if (errors.length) {
  console.error('PAGE_ERRORS', errors.slice(0, 5));
}
