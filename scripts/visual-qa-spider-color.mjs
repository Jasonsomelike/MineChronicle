import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
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
  c.width = 64;
  c.height = 32;
  const x = c.getContext('2d');
  x.fillStyle = '#808080';
  x.fillRect(0, 0, 64, 32);
  x.fillStyle = '#ff0000';
  x.fillRect(32, 4, 8, 8);
  x.fillStyle = '#00ff00';
  x.fillRect(0, 0, 6, 6);
  x.fillStyle = '#0000ff';
  x.fillRect(0, 12, 10, 8);
  return c.toDataURL();
});

const job = {
  entityModel: {
    format: 'java',
    textureWidth: 64,
    textureHeight: 32,
    bones: [
      {
        name: 'head',
        pivot: [0, 0, 0],
        rotation: [0, 0, 0],
        cubes: [
          {
            origin: [-4, 11, -11],
            size: [8, 8, 8],
            uv: [32, 4],
            inflate: 0,
            mirror: false,
          },
        ],
      },
      {
        name: 'body',
        pivot: [0, 0, 0],
        rotation: [0, 0, 0],
        cubes: [
          {
            origin: [-3, 9, -3],
            size: [6, 6, 6],
            uv: [0, 0],
            inflate: 0,
            mirror: false,
          },
        ],
      },
      {
        name: 'rear',
        pivot: [0, 0, 0],
        rotation: [0, 0, 0],
        cubes: [
          {
            origin: [-5, 5, 3],
            size: [10, 8, 12],
            uv: [0, 12],
            inflate: 0,
            mirror: false,
          },
        ],
      },
    ],
  },
  layers: [tex],
  rotation: [10, 200, 0],
  renderSize: 512,
};
const r = await page.evaluate(async (j) => {
  const { renderRuntime } = await import('/scripts/stat-icon-renderer.mjs');
  return await renderRuntime(j);
}, job);
fs.writeFileSync(
  path.join(outDir, 'qa2-spider-color.png'),
  Buffer.from(r.image.split(',')[1], 'base64'),
);
console.log('ok', r.width, r.height);
await browser.close();
server.kill('SIGTERM');
