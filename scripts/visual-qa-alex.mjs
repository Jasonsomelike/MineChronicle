/**
 * Playwright visual QA for remaining problem entities.
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

const ps1 = path.join(process.cwd(), 'scripts', 'extract-class.ps1');
const pngPs = path.join(process.cwd(), 'scripts', 'extract-png.ps1');
const alex = String.raw`D:\QQ下载\落幕曲\.minecraft\versions\落幕曲\mods\alexsmobs-1.22.9.jar`;
const citadel = String.raw`D:\QQ下载\落幕曲\.minecraft\versions\落幕曲\mods\citadel-2.6.1-1.20.1.jar`;
const scaves = String.raw`D:\QQ下载\服务器3.0\服务器3.0\.minecraft\versions\Create-Delight-Remake\mods\alexscaves-2.0.2.jar`;

function extractClass(jar, cls) {
  const t = path.join(os.tmpdir(), `c-${Math.random()}.class`);
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
  const t = path.join(os.tmpdir(), `p-${Math.random()}.png`);
  execFileSync(
    'powershell',
    ['-NoProfile', '-File', pngPs, '-Jar', jar, '-Entry', entry, '-Out', t],
    { stdio: 'pipe' },
  );
  return fs.readFileSync(t);
}

const specs = [
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
];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
page.on('pageerror', (e) => console.error('PAGE', e.message));
await page.goto('http://127.0.0.1:1420/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);

for (const spec of specs) {
  try {
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
    classes[spec.className] = primary.toString('base64');
    // walk supers via class_super_name in parser
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
      classes[superName] = parent.toString('base64');
      bytes = parent;
    }
    const tex = extractPng(spec.texJar, spec.tex);
    const job = {
      javaModel: { className: spec.className, classes },
      layers: [`data:image/png;base64,${tex.toString('base64')}`],
      textureWidth: 128,
      textureHeight: 128,
      renderSize: 512,
    };
    const result = await page.evaluate(async (j) => {
      const { renderRuntime } = await import('/scripts/stat-icon-renderer.mjs');
      return await renderRuntime(j);
    }, job);
    const bin = Buffer.from(result.image.split(',')[1], 'base64');
    const file = path.join(outDir, `qa-${spec.id}.png`);
    fs.writeFileSync(file, bin);
    console.log('OK', spec.id, result.width, result.height, bin.length);
  } catch (e) {
    console.log('FAIL', spec.id, e.message);
  }
}

await browser.close();
server.kill('SIGTERM');
