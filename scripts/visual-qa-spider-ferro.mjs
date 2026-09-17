/**
 * Focused QA: Java spider template + ferrouslime after UV/cap fixes.
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
for (let i = 0; i < 100 && !ready; i += 1) await delay(250);
await delay(1500);

const ps1 = path.join(process.cwd(), 'scripts', 'extract-class.ps1');
const pngPs = path.join(process.cwd(), 'scripts', 'extract-png.ps1');
const scaves = String.raw`D:\QQ下载\落幕曲\.minecraft\versions\落幕曲\mods\alexscaves-2.0.1.jar`;
const citadel = String.raw`D:\QQ下载\落幕曲\.minecraft\versions\落幕曲\mods\citadel-2.6.1-1.20.1.jar`;
const mcJar = String.raw`D:\QQ下载\服务器3.0\服务器3.0\.minecraft\versions\1.21.11-Fabric 0.18.4\1.21.11-Fabric 0.18.4.jar`;

function extractClass(jar, cls) {
  const t = path.join(os.tmpdir(), `q-${Math.random()}.class`);
  try {
    execFileSync(
      'powershell',
      ['-NoProfile', '-File', ps1, '-Jar', jar, '-Class', cls, '-Out', t],
      { stdio: 'pipe' },
    );
    return fs.readFileSync(t);
  } catch {
    return null;
  }
}
function extractPng(jar, entry) {
  const t = path.join(os.tmpdir(), `qp-${Math.random()}.png`);
  execFileSync(
    'powershell',
    ['-NoProfile', '-File', pngPs, '-Jar', jar, '-Entry', entry, '-Out', t],
    { stdio: 'pipe' },
  );
  return fs.readFileSync(t);
}
const b64 = (buf) => buf.toString('base64');

const spiderBones = [
  {
    name: 'head',
    pivot: [0, 15, -3],
    rotation: [0, 0, 0],
    cubes: [{ origin: [-4, -4, -8], size: [8, 8, 8], uv: [32, 4] }],
  },
  {
    name: 'body',
    pivot: [0, 15, 0],
    rotation: [0, 0, 0],
    cubes: [{ origin: [-3, -3, -3], size: [6, 6, 6], uv: [0, 0] }],
  },
  {
    name: 'rear',
    pivot: [0, 15, 9],
    rotation: [-0.7853982, 0, 0],
    cubes: [{ origin: [-5, -4, -6], size: [10, 8, 12], uv: [0, 12] }],
  },
  ...[
    [-4, 15, 2, 0.7853982],
    [4, 15, 2, -0.7853982],
    [-4, 15, 1, 0.3926991],
    [4, 15, 1, -0.3926991],
    [-4, 15, 0, -0.3926991],
    [4, 15, 0, 0.3926991],
    [-4, 15, -1, -0.7853982],
    [4, 15, -1, 0.7853982],
  ].map((leg, i) => ({
    name: `leg${i}`,
    pivot: [leg[0], leg[1], leg[2]],
    rotation: [0, leg[3], 0],
    cubes: [{ origin: [-15, -1, -1], size: [16, 2, 2], uv: [18, 0] }],
  })),
];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
await page.goto('http://127.0.0.1:1420/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);

const { parseClassFile } = await import(
  new URL('./java-entity-runtime.mjs', import.meta.url).href
);
const ferroPrimary = extractClass(
  scaves,
  'com.github.alexmodguy.alexscaves.client.model.FerrouslimeModel',
);
if (!ferroPrimary) throw new Error('no FerrouslimeModel');
const ferroClasses = {
  'com.github.alexmodguy.alexscaves.client.model.FerrouslimeModel':
    b64(ferroPrimary),
};
{
  let bytes = ferroPrimary;
  for (let i = 0; i < 6; i += 1) {
    const parsed = parseClassFile(bytes);
    if (
      !parsed.superName ||
      /EntityModel|AdvancedEntityModel|ListModel$/.test(parsed.superName)
    )
      break;
    const parent =
      extractClass(citadel, parsed.superName) ||
      extractClass(scaves, parsed.superName);
    if (!parent) break;
    ferroClasses[parsed.superName] = b64(parent);
    bytes = parent;
  }
}

const jobs = [
  {
    id: 'poison_spider',
    job: {
      entityModel: {
        format: 'java',
        textureWidth: 64,
        textureHeight: 32,
        bones: spiderBones,
      },
      layers: [
        `data:image/png;base64,${b64(
          extractPng(
            mcJar,
            'assets/minecraft/textures/entity/spider/spider.png',
          ),
        )}`,
      ],
      rotation: [8, 200, 0],
      renderSize: 512,
    },
  },
  {
    id: 'ferrouslime',
    job: {
      javaModel: {
        className:
          'com.github.alexmodguy.alexscaves.client.model.FerrouslimeModel',
        classes: ferroClasses,
      },
      layers: [
        `data:image/png;base64,${b64(
          extractPng(
            scaves,
            'assets/alexscaves/textures/entity/ferrouslime.png',
          ),
        )}`,
      ],
      renderSize: 512,
    },
  },
];

const report = [];
for (const spec of jobs) {
  const result = await page.evaluate(async (j) => {
    const { renderRuntime } = await import('/scripts/stat-icon-renderer.mjs');
    return await renderRuntime(j);
  }, spec.job);
  const bin = Buffer.from(result.image.split(',')[1], 'base64');
  const file = path.join(outDir, `qa4-${spec.id}.png`);
  fs.writeFileSync(file, bin);
  const stats = await page.evaluate(async (dataUrl) => {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let nonblack = 0,
      minX = c.width,
      minY = c.height,
      maxX = -1,
      maxY = -1;
    let rSum = 0,
      gSum = 0,
      bSum = 0,
      n = 0;
    for (let y = 0; y < c.height; y += 1)
      for (let x = 0; x < c.width; x += 1) {
        const i = (y * c.width + x) * 4;
        if (d[i] + d[i + 1] + d[i + 2] > 24 && d[i + 3] > 8) {
          nonblack += 1;
          rSum += d[i];
          gSum += d[i + 1];
          bSum += d[i + 2];
          n += 1;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    return {
      width: c.width,
      height: c.height,
      nonblack,
      bbox_w: maxX >= 0 ? maxX - minX + 1 : 0,
      bbox_h: maxY >= 0 ? maxY - minY + 1 : 0,
      avg: n
        ? [Math.round(rSum / n), Math.round(gSum / n), Math.round(bSum / n)]
        : [0, 0, 0],
    };
  }, result.image);
  report.push({ id: spec.id, file, ...stats });
  console.log(spec.id, stats.bbox_w, stats.bbox_h, 'avg', stats.avg);
}

fs.writeFileSync(
  path.join(outDir, 'qa4-spider-ferro.json'),
  JSON.stringify(report, null, 2),
);
await browser.close();
server.kill('SIGTERM');
