import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseJavaModelFromClass } from './java-entity-runtime.mjs';

const jar = process.argv[2];
const names = process.argv.slice(3);
const ps1 = path.join(process.cwd(), 'scripts', 'extract-class.ps1');
const citadel = String.raw`D:\QQ下载\落幕曲\.minecraft\versions\落幕曲\mods\citadel-2.6.1-1.20.1.jar`;
function extract(archive, cls) {
  const t = path.join(os.tmpdir(), `z-${Math.random()}.class`);
  try {
    execFileSync(
      'powershell',
      ['-NoProfile', '-File', ps1, '-Jar', archive, '-Class', cls, '-Out', t],
      { stdio: 'pipe' },
    );
    return fs.readFileSync(t);
  } catch {
    return null;
  }
}
const resolve = (n) => extract(jar, n) || extract(citadel, n);
for (const cls of names) {
  const b = extract(jar, cls);
  if (!b) {
    console.log(cls, 'NOCLASS');
    continue;
  }
  try {
    const m = parseJavaModelFromClass(b, resolve);
    const cubes = m.bones.reduce((s, x) => s + x.cubes.length, 0);
    console.log(
      'OK',
      cls,
      m.textureWidth,
      m.textureHeight,
      'bones',
      m.bones.length,
      'cubes',
      cubes,
    );
  } catch (e) {
    console.log('FAIL', cls, e.message);
  }
}
