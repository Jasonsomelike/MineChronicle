import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseJavaModelFromClass } from './java-entity-runtime.mjs';

const alex = String.raw`D:\QQ下载\落幕曲\.minecraft\versions\落幕曲\mods\alexsmobs-1.22.9.jar`;
const citadel = String.raw`D:\QQ下载\落幕曲\.minecraft\versions\落幕曲\mods\citadel-2.6.1-1.20.1.jar`;
const ps1 = path.join(process.cwd(), 'scripts', 'extract-class.ps1');
function extract(jar, name) {
  const tmp = path.join(os.tmpdir(), `c-${Math.random()}.class`);
  try {
    execFileSync(
      'powershell',
      ['-NoProfile', '-File', ps1, '-Jar', jar, '-Class', name, '-Out', tmp],
      { stdio: 'pipe' },
    );
    return fs.readFileSync(tmp);
  } catch {
    return null;
  }
}
const resolve = (n) => extract(alex, n) || extract(citadel, n);
const bytes = extract(
  alex,
  'com.github.alexthe666.alexsmobs.client.model.ModelGrizzlyBear',
);
try {
  const m = parseJavaModelFromClass(bytes, resolve);
  console.log(
    'OK',
    m.textureWidth,
    m.textureHeight,
    'bones',
    m.bones.length,
    'cubes',
    m.bones.reduce((s, b) => s + b.cubes.length, 0),
  );
  console.log(
    m.bones
      .slice(0, 6)
      .map((b) => ({ n: b.name, p: b.pivot, c: b.cubes.length })),
  );
} catch (e) {
  console.error('FAIL', e.message);
}
