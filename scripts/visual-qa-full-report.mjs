/**
 * Full entity icon QA report with hard quality gates.
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
const alex = String.raw`D:\QQ下载\落幕曲\.minecraft\versions\落幕曲\mods\alexsmobs-1.22.9.jar`;
const citadel = String.raw`D:\QQ下载\落幕曲\.minecraft\versions\落幕曲\mods\citadel-2.6.1-1.20.1.jar`;
const scaves = String.raw`D:\QQ下载\服务器3.0\服务器3.0\.minecraft\versions\Create-Delight-Remake\mods\alexscaves-2.0.2.jar`;
const iaf = String.raw`D:\QQ下载\落幕曲\.minecraft\versions\落幕曲\mods\iceandfire-2.1.13-1.20.1-beta-5.jar`;
const goety = String.raw`D:\QQ下载\落幕曲\.minecraft\versions\落幕曲\mods\goety-2.5.35.1.jar`;
const mc = String.raw`D:\QQ下载\服务器3.0\服务器3.0\.minecraft\versions\1.21.11-Fabric 0.18.4\1.21.11-Fabric 0.18.4.jar`;

function extractClass(jar, cls) {
  const t = path.join(os.tmpdir(), `f-${Math.random()}.class`);
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
  const t = path.join(os.tmpdir(), `fp-${Math.random()}.png`);
  execFileSync(
    'powershell',
    ['-NoProfile', '-File', pngPs, '-Jar', jar, '-Entry', entry, '-Out', t],
    { stdio: 'pipe' },
  );
  return fs.readFileSync(t);
}
const b64 = (buf) => buf.toString('base64');

const specs = [
  {
    id: 'poison_spider',
    spiderTemplate: true,
    texJar: mc,
    tex: 'assets/minecraft/textures/entity/spider/spider.png',
  },
  {
    id: 'grizzly_bear',
    className: 'com.github.alexthe666.alexsmobs.client.model.ModelGrizzlyBear',
    jars: [alex, citadel],
    texJar: alex,
    tex: 'assets/alexsmobs/textures/entity/grizzly_bear.png',
  },
  {
    id: 'mosquito',
    className:
      'com.github.alexthe666.alexsmobs.client.model.ModelCrimsonMosquito',
    jars: [alex, citadel],
    texJar: alex,
    tex: 'assets/alexsmobs/textures/entity/crimson_mosquito.png',
  },
  {
    id: 'tusklin',
    className: 'com.github.alexthe666.alexsmobs.client.model.ModelTusklin',
    jars: [alex, citadel],
    texJar: alex,
    tex: 'assets/alexsmobs/textures/entity/tusklin.png',
  },
  {
    id: 'ferrouslime',
    className: 'com.github.alexmodguy.alexscaves.client.model.FerrouslimeModel',
    jars: [scaves, citadel],
    texJar: scaves,
    tex: 'assets/alexscaves/textures/entity/ferrouslime.png',
  },
  {
    id: 'cyclops',
    className: 'com.github.alexthe666.iceandfire.client.model.ModelCyclops',
    jars: [iaf, citadel],
    texJar: iaf,
    tex: 'assets/iceandfire/textures/models/cyclops/cyclops_0.png',
  },
  {
    id: 'deathworm',
    className: 'com.github.alexthe666.iceandfire.client.model.ModelDeathWorm',
    jars: [iaf, citadel],
    texJar: iaf,
    tex: 'assets/iceandfire/textures/models/deathworm/deathworm_white.png',
  },
  {
    id: 'ghost',
    className: 'com.github.alexthe666.iceandfire.client.model.ModelGhost',
    jars: [iaf, citadel],
    texJar: iaf,
    tex: 'assets/iceandfire/textures/models/ghost/ghost_white.png',
  },
  {
    id: 'apostle_humanoid',
    humanoid: true,
    texJar: goety,
    tex: 'assets/goety/textures/entity/cultist/apostle.png',
  },
];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
await page.goto('http://127.0.0.1:1420/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);

const report = [];
for (const spec of specs) {
  try {
    let job;
    if (spec.spiderTemplate) {
      const tex = extractPng(spec.texJar, spec.tex);
      job = {
        entityModel: {
          format: 'java',
          textureWidth: 64,
          textureHeight: 32,
          bones: [
            {
              name: 'head',
              pivot: [0, 15, -3],
              rotation: [0, 0, 0],
              cubes: [
                {
                  origin: [-4, -4, -8],
                  size: [8, 8, 8],
                  uv: [32, 4],
                  inflate: 0,
                  mirror: false,
                },
              ],
            },
            {
              name: 'body',
              pivot: [0, 15, 0],
              rotation: [0, 0, 0],
              cubes: [
                {
                  origin: [-3, -3, -3],
                  size: [6, 6, 6],
                  uv: [0, 0],
                  inflate: 0,
                  mirror: false,
                },
              ],
            },
            {
              name: 'rear',
              pivot: [0, 15, 9],
              rotation: [-0.7853982, 0, 0],
              cubes: [
                {
                  origin: [-5, -4, -6],
                  size: [10, 8, 12],
                  uv: [0, 12],
                  inflate: 0,
                  mirror: false,
                },
              ],
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
              cubes: [
                {
                  origin: [-15, -1, -1],
                  size: [16, 2, 2],
                  uv: [18, 0],
                  inflate: 0,
                  mirror: false,
                },
              ],
            })),
          ],
        },
        layers: [`data:image/png;base64,${b64(tex)}`],
        rotation: [15, 200, 0],
        renderSize: 512,
      };
    } else if (spec.humanoid) {
      const tex = extractPng(spec.texJar, spec.tex);
      job = {
        entityModel: {
          format: 'java',
          textureWidth: 64,
          textureHeight: 64,
          bones: [
            {
              name: 'head',
              pivot: [0, 24, 0],
              rotation: [0, 0, 0],
              cubes: [
                {
                  origin: [-4, 24, -4],
                  size: [8, 8, 8],
                  uv: [0, 0],
                  inflate: 0,
                  mirror: false,
                },
              ],
            },
            {
              name: 'body',
              pivot: [0, 24, 0],
              rotation: [0, 0, 0],
              cubes: [
                {
                  origin: [-4, 12, -2],
                  size: [8, 12, 4],
                  uv: [16, 16],
                  inflate: 0,
                  mirror: false,
                },
              ],
            },
          ],
        },
        layers: [`data:image/png;base64,${b64(tex)}`],
        renderSize: 512,
      };
    } else {
      const classes = {};
      const resolve = (n) => {
        for (const jar of spec.jars) {
          const b = extractClass(jar, n);
          if (b) return b;
        }
        return null;
      };
      const primary = extractClass(spec.jars[0], spec.className);
      if (!primary) throw new Error('no class');
      classes[spec.className] = b64(primary);
      const { parseClassFile } = await import(
        new URL('./java-entity-runtime.mjs', import.meta.url).href
      );
      let bytes = primary;
      for (let i = 0; i < 8; i += 1) {
        const parsed = parseClassFile(bytes);
        const superName = parsed.superName;
        if (
          !superName ||
          superName === 'java.lang.Object' ||
          /EntityModel|AdvancedEntityModel|ListModel|HumanoidModel|AgeableListModel$/.test(
            superName,
          )
        )
          break;
        const parent = resolve(superName);
        if (!parent) break;
        classes[superName] = b64(parent);
        bytes = parent;
      }
      const tex = extractPng(spec.texJar, spec.tex);
      job = {
        javaModel: { className: spec.className, classes },
        layers: [`data:image/png;base64,${b64(tex)}`],
        // UV canvas comes from the model class, not a guessed atlas size.
        renderSize: 512,
      };
    }
    const result = await page.evaluate(async (j) => {
      const { renderRuntime } = await import('/scripts/stat-icon-renderer.mjs');
      return await renderRuntime(j);
    }, job);
    const bin = Buffer.from(result.image.split(',')[1], 'base64');
    const file = path.join(outDir, `full-${spec.id}.png`);
    fs.writeFileSync(file, bin);
    // Measure non-black pixels via browser canvas
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
      let nonblack = 0;
      let minX = c.width,
        minY = c.height,
        maxX = -1,
        maxY = -1;
      for (let y = 0; y < c.height; y += 1)
        for (let x = 0; x < c.width; x += 1) {
          const i = (y * c.width + x) * 4;
          if (d[i] + d[i + 1] + d[i + 2] > 24 && d[i + 3] > 8) {
            nonblack += 1;
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
      };
    }, result.image);
    const ratio = stats.nonblack / (stats.width * stats.height);
    const ok =
      stats.nonblack >= 200 &&
      ratio >= 0.02 &&
      stats.bbox_w >= 8 &&
      stats.bbox_h >= 8;
    report.push({
      id: spec.id,
      ok,
      width: stats.width,
      height: stats.height,
      nonblack_ratio: Number(ratio.toFixed(4)),
      bbox_w: stats.bbox_w,
      bbox_h: stats.bbox_h,
      file,
    });
    console.log(
      ok ? 'OK' : 'FAIL',
      spec.id,
      ratio.toFixed(3),
      stats.bbox_w,
      stats.bbox_h,
    );
  } catch (e) {
    report.push({ id: spec.id, ok: false, error: String(e.message || e) });
    console.log('FAIL', spec.id, e.message);
  }
}

fs.writeFileSync(
  path.join(outDir, 'entity-render-report.json'),
  JSON.stringify(report, null, 2),
);
const fails = report.filter((r) => !r.ok).length;
console.log(`REPORT total=${report.length} failed=${fails}`);
await browser.close();
server.kill('SIGTERM');
process.exit(fails ? 1 : 0);
