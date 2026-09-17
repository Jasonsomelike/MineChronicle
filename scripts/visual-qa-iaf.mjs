/**
 * Render iceandfire cyclops/deathworm/ghost with known texture paths.
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
await delay(1000);

const ps1 = path.join(process.cwd(), 'scripts', 'extract-class.ps1');
const pngPs = path.join(process.cwd(), 'scripts', 'extract-png.ps1');
const iaf = String.raw`D:\QQ下载\落幕曲\.minecraft\versions\落幕曲\mods\iceandfire-2.1.13-1.20.1-beta-5.jar`;
const citadel = String.raw`D:\QQ下载\落幕曲\.minecraft\versions\落幕曲\mods\citadel-2.6.1-1.20.1.jar`;

function extractClass(jar, cls) {
  const t = path.join(os.tmpdir(), `i-${Math.random()}.class`);
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
  const t = path.join(os.tmpdir(), `ip-${Math.random()}.png`);
  execFileSync(
    'powershell',
    ['-NoProfile', '-File', pngPs, '-Jar', jar, '-Entry', entry, '-Out', t],
    { stdio: 'pipe' },
  );
  return fs.readFileSync(t);
}

const specs = [
  {
    id: 'cyclops',
    className: 'com.github.alexthe666.iceandfire.client.model.ModelCyclops',
    tex: 'assets/iceandfire/textures/models/cyclops/cyclops_0.png',
  },
  {
    id: 'deathworm',
    className: 'com.github.alexthe666.iceandfire.client.model.ModelDeathWorm',
    tex: 'assets/iceandfire/textures/models/deathworm/deathworm_white.png',
  },
  {
    id: 'ghost',
    className: 'com.github.alexthe666.iceandfire.client.model.ModelGhost',
    tex: 'assets/iceandfire/textures/models/ghost/ghost_white.png',
  },
];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
await page.goto('http://127.0.0.1:1420/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);

const report = [];
for (const spec of specs) {
  try {
    const classes = {};
    const resolve = (n) => extractClass(iaf, n) || extractClass(citadel, n);
    const primary = extractClass(iaf, spec.className);
    if (!primary) throw new Error('no class');
    classes[spec.className] = primary.toString('base64');
    const { parseClassFile } = await import(
      new URL('./java-entity-runtime.mjs', import.meta.url).href
    );
    let bytes = primary;
    for (let i = 0; i < 6; i += 1) {
      const parsed = parseClassFile(bytes);
      const superName = parsed.superName;
      if (
        !superName ||
        /EntityModel|AdvancedEntityModel|ListModel|HumanoidModel$/.test(
          superName,
        )
      )
        break;
      const parent = resolve(superName);
      if (!parent) break;
      classes[superName] = parent.toString('base64');
      bytes = parent;
    }
    const tex = extractPng(iaf, spec.tex);
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
    const file = path.join(outDir, `iaf-${spec.id}.png`);
    fs.writeFileSync(file, bin);
    report.push({ id: spec.id, ok: true, bytes: bin.length });
    console.log('OK', spec.id, bin.length);
  } catch (e) {
    report.push({ id: spec.id, ok: false, error: String(e.message || e) });
    console.log('FAIL', spec.id, e.message);
  }
}
fs.writeFileSync(
  path.join(outDir, 'entity-render-report.json'),
  JSON.stringify(report, null, 2),
);
await browser.close();
server.kill('SIGTERM');
