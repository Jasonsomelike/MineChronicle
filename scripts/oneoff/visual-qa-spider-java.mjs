/**
 * Visual QA: render spider as Java-format model (known-good path for Grizzly).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
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
await delay(1200);

const mc = String.raw`D:\QQ下载\服务器3.0\服务器3.0\.minecraft\versions\1.21.11-Fabric 0.18.4\1.21.11-Fabric 0.18.4.jar`;
const extractPs = path.join(process.cwd(), 'scripts', 'extract-png.ps1');
const tmp = path.join(os.tmpdir(), `qa2-${Math.random()}.png`);
execFileSync(
  'powershell',
  [
    '-NoProfile',
    '-File',
    extractPs,
    '-Jar',
    mc,
    '-Entry',
    'assets/minecraft/textures/entity/spider/spider.png',
    '-Out',
    tmp,
  ],
  { stdio: 'pipe' },
);
const tex = fs.readFileSync(tmp);

// Java ModelSpider coordinates (Minecraft source).
const spiderJava = {
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
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 300, height: 300 } });
await page.goto('http://127.0.0.1:1420/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);

const job = {
  entityModel: spiderJava,
  layers: [`data:image/png;base64,${tex.toString('base64')}`],
  rotation: [10, 200, 0],
  renderSize: 512,
};
const result = await page.evaluate(async (j) => {
  const { renderRuntime } = await import('/scripts/stat-icon-renderer.mjs');
  return await renderRuntime(j);
}, job);
const bin = Buffer.from(result.image.split(',')[1], 'base64');
const file = path.join(outDir, 'qa-spider-java.png');
fs.writeFileSync(file, bin);
console.log('wrote', file, result.width, result.height, bin.length);
await browser.close();
server.kill('SIGTERM');
