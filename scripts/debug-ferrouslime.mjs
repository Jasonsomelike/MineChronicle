import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { setTimeout as delay } from 'node:timers/promises';

const scaves = String.raw`D:\QQ下载\服务器3.0\服务器3.0\.minecraft\versions\Create-Delight-Remake\mods\alexscaves-2.0.2.jar`;
const citadel = String.raw`D:\QQ下载\落幕曲\.minecraft\versions\落幕曲\mods\citadel-2.6.1-1.20.1.jar`;
const ps1 = path.join(process.cwd(), 'scripts', 'extract-class.ps1');
const pngPs = path.join(process.cwd(), 'scripts', 'extract-png.ps1');

function extractClass(jar, cls) {
  const t = path.join(os.tmpdir(), `d-${Math.random()}.class`);
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

const classes = {};
const name = 'com.github.alexmodguy.alexscaves.client.model.FerrouslimeModel';
classes[name] = extractClass(scaves, name).toString('base64');
const texTmp = path.join(os.tmpdir(), `f-${Math.random()}.png`);
execFileSync(
  'powershell',
  [
    '-NoProfile',
    '-File',
    pngPs,
    '-Jar',
    scaves,
    '-Entry',
    'assets/alexscaves/textures/entity/ferrouslime.png',
    '-Out',
    texTmp,
  ],
  { stdio: 'pipe' },
);
const tex = fs.readFileSync(texTmp).toString('base64');

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
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:1420/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);
const info = await page.evaluate(async ({ className, classes, tex }) => {
  const { parseJavaModelFromClass } = await import(
    '/scripts/java-entity-runtime.mjs'
  );
  const decode = (b64) => {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  };
  const map = {};
  for (const [k, v] of Object.entries(classes)) map[k] = decode(v);
  const model = parseJavaModelFromClass(map[className], (n) => map[n] ?? null);
  return {
    model,
    texLen: tex.length,
  };
}, { className: name, classes, tex });
console.log('bones', info.model.bones.length, 'cubes', info.model.bones.reduce((s, b) => s + b.cubes.length, 0));
console.log(JSON.stringify(info.model.bones[0], null, 2));
await browser.close();
server.kill('SIGTERM');
