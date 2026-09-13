import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { setTimeout as delay } from 'node:timers/promises';

const outDir = path.join(process.cwd(), 'output', 'playwright');
const server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1'], {
  cwd: process.cwd(),
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let ready = false;
server.stdout.on('data', (c) => {
  if (String(c).includes('Local:')) ready = true;
});
for (let i = 0; i < 80 && !ready; i += 1) await delay(250);
await delay(1000);

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 300, height: 300 } });
await page.goto('http://127.0.0.1:1420/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(600);
const tex = await page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 16;
  const x = c.getContext('2d');
  x.fillStyle = '#308030';
  x.fillRect(0, 0, 16, 16);
  x.fillStyle = '#ff2020';
  x.fillRect(0, 0, 4, 4);
  return c.toDataURL();
});

async function shot(name, job) {
  const r = await page.evaluate(async (j) => {
    const { renderRuntime } = await import('/scripts/stat-icon-renderer.mjs');
    return await renderRuntime(j);
  }, job);
  const bin = Buffer.from(r.image.split(',')[1], 'base64');
  const f = path.join(outDir, name);
  fs.writeFileSync(f, bin);
  console.log(name, bin.length);
  return f;
}

// two cubes, java, pivot 0
await shot(
  'qa2-two-box-java.png',
  {
    entityModel: {
      format: 'java',
      textureWidth: 16,
      textureHeight: 16,
      bones: [
        {
          name: 'a',
          pivot: [0, 0, 0],
          rotation: [0, 0, 0],
          cubes: [{ origin: [-4, -4, -4], size: [8, 8, 8], uv: [0, 0], inflate: 0, mirror: false }],
        },
        {
          name: 'b',
          pivot: [0, 0, 0],
          rotation: [0, 0, 0],
          cubes: [{ origin: [-4, -4, 4], size: [8, 8, 8], uv: [0, 0], inflate: 0, mirror: false }],
        },
      ],
    },
    layers: [tex],
    rotation: [20, 30, 0],
    renderSize: 256,
  },
);

await browser.close();
server.kill('SIGTERM');
