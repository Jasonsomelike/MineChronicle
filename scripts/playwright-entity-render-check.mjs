import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { setTimeout as delay } from 'node:timers/promises';

const outDir = path.join(process.cwd(), 'output', 'playwright');
fs.mkdirSync(outDir, { recursive: true });
const origin = 'http://127.0.0.1:1420';
const server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1'], {
  cwd: process.cwd(),
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let ready = false;
server.stdout.on('data', (c) => {
  if (String(c).includes('Local:')) ready = true;
});
server.stderr.on('data', () => {});
for (let i = 0; i < 80 && !ready; i += 1) await delay(250);
await delay(1500);

const ps1 = path.join(process.cwd(), 'scripts', 'extract-class.ps1');
const alex = String.raw`D:\QQ下载\落幕曲\.minecraft\versions\落幕曲\mods\alexsmobs-1.22.9.jar`;
const citadel = String.raw`D:\QQ下载\落幕曲\.minecraft\versions\落幕曲\mods\citadel-2.6.1-1.20.1.jar`;
const goety = String.raw`D:\QQ下载\落幕曲\.minecraft\versions\落幕曲\mods\goety-2.5.35.1.jar`;
const iaf = String.raw`D:\QQ下载\落幕曲\.minecraft\versions\落幕曲\mods\iceandfire-2.1.13-1.20.1-beta-5.jar`;
const scaves = String.raw`D:\QQ下载\服务器3.0\服务器3.0\.minecraft\versions\Create-Delight-Remake\mods\alexscaves-2.0.2.jar`;
const mc = String.raw`D:\QQ下载\服务器3.0\服务器3.0\.minecraft\versions\1.21.11-Fabric 0.18.4\1.21.11-Fabric 0.18.4.jar`;

function extract(jar, cls) {
  const t = path.join(os.tmpdir(), `v-${Math.random()}.class`);
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
  const script = `
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z=[IO.Compression.ZipFile]::OpenRead('${jar.replaceAll("'", "''")}')
try {
  $e=$z.Entries | Where-Object { $_.FullName -eq '${entry}' }
  if (-not $e) { exit 2 }
  $s=$e.Open(); $ms=New-Object IO.MemoryStream; $s.CopyTo($ms)
  [IO.File]::WriteAllBytes('${t.replaceAll("'", "''")}', $ms.ToArray())
} finally { $z.Dispose() }
`;
  execFileSync('powershell', ['-NoProfile', '-Command', script], {
    stdio: 'pipe',
  });
  return fs.readFileSync(t);
}
const b64 = (buf) => buf.toString('base64');
const pngData = (buf) => `data:image/png;base64,${b64(buf)}`;

const jobs = [
  {
    id: 'grizzly_bear',
    jars: [alex, citadel],
    className: 'com.github.alexthe666.alexsmobs.client.model.ModelGrizzlyBear',
    textureJar: alex,
    texture: 'assets/alexsmobs/textures/entity/grizzly_bear.png',
  },
  {
    id: 'ferrouslime',
    jars: [scaves, citadel],
    className: 'com.github.alexmodguy.alexscaves.client.model.FerrouslimeModel',
    textureJar: scaves,
    texture: 'assets/alexscaves/textures/entity/ferrouslime.png',
  },
  {
    id: 'poison_spider',
    textureJar: mc,
    texture: 'assets/minecraft/textures/entity/spider/spider.png',
    vanillaSpider: true,
  },
  {
    id: 'cyclops',
    jars: [iaf, citadel],
    className: 'com.github.alexthe666.iceandfire.client.model.ModelCyclops',
    textureJar: iaf,
    texture: 'assets/iceandfire/textures/entity/cyclops/cyclops.png',
  },
  {
    id: 'deathworm',
    jars: [iaf, citadel],
    className: 'com.github.alexthe666.iceandfire.client.model.ModelDeathWorm',
    textureJar: iaf,
    texture: 'assets/iceandfire/textures/entity/deathworm/deathworm.png',
  },
  {
    id: 'apostle_humanoid',
    textureJar: goety,
    texture: 'assets/goety/textures/entity/cultist/apostle.png',
    humanoid: true,
  },
];

// resolve deathworm texture alternatives
function anyPng(jar, patterns) {
  const script = `
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z=[IO.Compression.ZipFile]::OpenRead('${jar.replaceAll("'", "''")}')
$z.Entries | Where-Object { ${patterns} } | Select-Object -ExpandProperty FullName
$z.Dispose()
`;
  const out = execFileSync('powershell', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
  });
  return out.split(/\r?\n/).filter(Boolean);
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
page.on('pageerror', (e) => console.error('PAGE', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.error('CON', m.text());
});

await page.goto(`${origin}/`, {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
});
await page.waitForTimeout(1000);

const results = [];
for (const spec of jobs) {
  try {
    const payload = { id: spec.id };
    if (spec.className) {
      const classes = {};
      const resolve = (n) => {
        for (const jar of spec.jars) {
          const b = extract(jar, n);
          if (b) return b;
        }
        return null;
      };
      const primary = extract(spec.jars[0], spec.className);
      if (!primary) throw new Error('no class');
      classes[spec.className] = b64(primary);
      // collect a few superclasses
      const { parseClassFile } = await import(
        new URL('./java-entity-runtime.mjs', import.meta.url).href
      );
      // inline super walk using only this file's parse
      let bytes = primary;
      for (let i = 0; i < 6; i += 1) {
        const parsed = parseClassFile(bytes);
        const superName = parsed.superName;
        if (
          !superName ||
          superName === 'java.lang.Object' ||
          superName.endsWith('.EntityModel') ||
          superName.endsWith('.AdvancedEntityModel') ||
          superName.endsWith('.ListModel') ||
          superName.endsWith('.HumanoidModel')
        )
          break;
        const parent = resolve(superName);
        if (!parent) break;
        classes[superName] = b64(parent);
        bytes = parent;
      }
      let tex;
      try {
        tex = extractPng(spec.textureJar, spec.texture);
      } catch {
        // try alternatives
        const cands = anyPng(
          spec.textureJar,
          `$_.FullName -match 'textures/entity' -and $_.FullName -like '*.png' -and $_.FullName -match '${
            spec.id.split('_')[0]
          }'`,
        ).slice(0, 1);
        if (!cands.length) throw new Error('no texture');
        tex = extractPng(spec.textureJar, cands[0]);
        spec.texture = cands[0];
      }
      payload.job = {
        javaModel: { className: spec.className, classes },
        layers: [pngData(tex)],
        textureWidth: 128,
        textureHeight: 128,
        renderSize: 512,
      };
    } else if (spec.vanillaSpider) {
      const tex = extractPng(spec.textureJar, spec.texture);
      payload.job = {
        entityModel: {
          format: 'bedrock',
          textureWidth: 64,
          textureHeight: 32,
          bones: [
            {
              name: 'head',
              pivot: [0, 9, -3],
              cubes: [
                {
                  origin: [-4, 5, -11],
                  size: [8, 8, 8],
                  uv: [32, 4],
                  inflate: 0,
                  mirror: false,
                },
              ],
            },
            {
              name: 'body0',
              pivot: [0, 9, 0],
              cubes: [
                {
                  origin: [-3, 6, -3],
                  size: [6, 6, 6],
                  uv: [0, 0],
                  inflate: 0,
                  mirror: false,
                },
              ],
            },
            {
              name: 'body1',
              pivot: [0, 9, 9],
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
            ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
              const side = i < 4 ? -1 : 1;
              const pair = i % 4;
              const z = 2 - pair;
              return {
                name: `leg${i}`,
                pivot: [side * 4, 9, z],
                cubes: [
                  {
                    origin: [side * 4 - (side < 0 ? 8 : 0), 8, z - 1],
                    size: [16, 2, 2],
                    uv: [18, 0],
                    inflate: 0,
                    mirror: false,
                  },
                ],
              };
            }),
          ],
        },
        layers: [pngData(tex)],
        rotation: [8, 200, 0],
        renderSize: 512,
      };
    } else if (spec.humanoid) {
      const tex = extractPng(spec.textureJar, spec.texture);
      payload.job = {
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
        layers: [pngData(tex)],
        renderSize: 512,
      };
    }

    const result = await page.evaluate(async (job) => {
      const { renderRuntime } = await import('/scripts/stat-icon-renderer.mjs');
      return await renderRuntime(job);
    }, payload.job);

    const bin = Buffer.from(
      result.image.split(',')[1] ?? result.image,
      'base64',
    );
    const file = path.join(outDir, `entity-${spec.id}.png`);
    fs.writeFileSync(file, bin);
    results.push({
      id: spec.id,
      ok: true,
      w: result.width,
      h: result.height,
      bytes: bin.length,
      file,
    });
    console.log('OK', spec.id, result.width, result.height, bin.length);
  } catch (e) {
    results.push({ id: spec.id, ok: false, error: String(e.message || e) });
    console.log('FAIL', spec.id, e.message);
  }
}

await browser.close();
server.kill('SIGTERM');
fs.writeFileSync(
  path.join(outDir, 'entity-render-report.json'),
  JSON.stringify(results, null, 2),
);
console.log('REPORT', path.join(outDir, 'entity-render-report.json'));
process.exit(results.some((r) => r.ok) ? 0 : 1);
