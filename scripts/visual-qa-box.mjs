import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { setTimeout as delay } from 'node:timers/promises';

const outDir = path.join(process.cwd(), 'output', 'playwright');
fs.mkdirSync(outDir, { recursive: true });
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

// 8x8 checker texture
const canvasJob = async (page, job, name) => {
  const result = await page.evaluate(async (j) => {
    const { renderRuntime } = await import('/scripts/stat-icon-renderer.mjs');
    return await renderRuntime(j);
  }, job);
  const bin = Buffer.from(result.image.split(',')[1], 'base64');
  const file = path.join(outDir, name);
  fs.writeFileSync(file, bin);
  console.log(name, bin.length);
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 200, height: 200 } });
await page.goto('http://127.0.0.1:1420/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(600);

// simple red canvas texture
const tex = await page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 16;
  const x = c.getContext('2d');
  x.fillStyle = '#c04040';
  x.fillRect(0, 0, 16, 16);
  x.fillStyle = '#4040c0';
  x.fillRect(0, 0, 8, 8);
  return c.toDataURL('image/png');
});

await canvasJob(
  page,
  {
    entityModel: {
      format: 'java',
      textureWidth: 16,
      textureHeight: 16,
      bones: [
        {
          name: 'cube',
          pivot: [0, 0, 0],
          rotation: [0, 0, 0],
          cubes: [
            { origin: [-4, -4, -4], size: [8, 8, 8], uv: [0, 0], inflate: 0, mirror: false },
          ],
        },
      ],
    },
    layers: [tex],
    rotation: [20, 30, 0],
    renderSize: 256,
  },
  'qa-box-java.png',
);

await canvasJob(
  page,
  {
    entityModel: {
      format: 'bedrock',
      textureWidth: 16,
      textureHeight: 16,
      bones: [
        {
          name: 'cube',
          pivot: [0, 0, 0],
          rotation: [0, 0, 0],
          cubes: [
            { origin: [-4, 0, -4], size: [8, 8, 8], uv: [0, 0], inflate: 0, mirror: false },
          ],
        },
      ],
    },
    layers: [tex],
    rotation: [20, 30, 0],
    renderSize: 256,
  },
  'qa-box-bedrock.png',
);

await browser.close();
server.kill('SIGTERM');
