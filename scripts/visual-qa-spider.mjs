/**
 * Render a few known entity icons and write PNGs for visual QA.
 * Usage: node scripts/visual-qa-spider.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { setTimeout as delay } from 'node:timers/promises';
// Read as text rather than `import ... with { type: 'json' }`: Prettier 2.8.8
// cannot parse import attributes, which broke `npm run format:check`. Matches
// the JSON-reading convention used by the other scripts.
const vanilla = JSON.parse(
  fs.readFileSync(
    path.join(
      process.cwd(),
      'scripts',
      'resources',
      'stat-vanilla-entities.json',
    ),
    'utf8',
  ),
);

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
function extractPng(jar, entry) {
  const t = path.join(os.tmpdir(), `qa-${Math.random()}.png`);
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-File',
      path.join(process.cwd(), 'scripts', 'extract-png.ps1'),
      '-Jar',
      jar,
      '-Entry',
      entry,
      '-Out',
      t,
    ],
    { stdio: 'pipe' },
  );
  return fs.readFileSync(t);
}

// extract-png helper
const extractPs = path.join(process.cwd(), 'scripts', 'extract-png.ps1');
if (!fs.existsSync(extractPs)) {
  fs.writeFileSync(
    extractPs,
    `param([string]$Jar,[string]$Entry,[string]$Out)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z=[IO.Compression.ZipFile]::OpenRead($Jar)
try {
  $e=$z.Entries | Where-Object { $_.FullName -eq $Entry }
  if (-not $e) { exit 2 }
  $s=$e.Open(); $ms=New-Object IO.MemoryStream; $s.CopyTo($ms)
  [IO.File]::WriteAllBytes($Out, $ms.ToArray())
} finally { $z.Dispose() }
`,
  );
}

const spiderTex = extractPng(
  mc,
  'assets/minecraft/textures/entity/spider/spider.png',
);
const spiderModel = vanilla.spider.model;

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 300, height: 300 } });
await page.goto('http://127.0.0.1:1420/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);

const job = {
  entityModel: spiderModel,
  layers: [`data:image/png;base64,${spiderTex.toString('base64')}`],
  rotation: [8, 200, 0],
  renderSize: 512,
};
const result = await page.evaluate(async (j) => {
  const { renderRuntime } = await import('/scripts/stat-icon-renderer.mjs');
  return await renderRuntime(j);
}, job);
const bin = Buffer.from(result.image.split(',')[1], 'base64');
const file = path.join(outDir, 'qa-spider-correct.png');
fs.writeFileSync(file, bin);
console.log('wrote', file, result.width, result.height, bin.length);
await browser.close();
server.kill('SIGTERM');
