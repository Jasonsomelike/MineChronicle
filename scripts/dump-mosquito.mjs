import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  parseJavaModelFromClass,
  parseClassFile,
} from './java-entity-runtime.mjs';

const jar =
  'D:\\QQ下载\\落幕曲\\.minecraft\\versions\\落幕曲\\mods\\alexsmobs-1.22.9.jar';
const citadel =
  'D:\\QQ下载\\落幕曲\\.minecraft\\versions\\落幕曲\\mods\\citadel-2.6.1-1.20.1.jar';
const ps1 = path.join(process.cwd(), 'scripts', 'extract-class.ps1');

function extractClass(j, cls) {
  const t = path.join(os.tmpdir(), `m-${Math.random()}.class`);
  try {
    execFileSync(
      'powershell',
      ['-NoProfile', '-File', ps1, '-Jar', j, '-Class', cls, '-Out', t],
      { stdio: 'pipe' },
    );
    return fs.readFileSync(t);
  } catch {
    return null;
  }
}

const name =
  'com.github.alexthe666.alexsmobs.client.model.ModelCrimsonMosquito';
const classes = {};
let bytes = extractClass(jar, name);
if (!bytes) throw new Error('no class');
classes[name] = bytes;
for (let i = 0; i < 8; i += 1) {
  const p = parseClassFile(bytes);
  if (
    !p.superName ||
    /EntityModel|AdvancedEntityModel|ListModel|Ageable/.test(p.superName)
  )
    break;
  const parent =
    extractClass(citadel, p.superName) || extractClass(jar, p.superName);
  if (!parent) break;
  classes[p.superName] = parent;
  bytes = parent;
}
const model = parseJavaModelFromClass(classes[name], (n) => classes[n] ?? null);
console.log(
  'tex',
  model.textureWidth,
  model.textureHeight,
  'bones',
  model.bones.length,
);
for (const b of model.bones) {
  for (const c of b.cubes ?? []) {
    console.log(
      b.name,
      'size',
      c.size.join('x'),
      'origin',
      c.origin.join(','),
      'uv',
      c.uv,
    );
  }
}
