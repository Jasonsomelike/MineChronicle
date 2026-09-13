import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseJavaModelFromClass } from './java-entity-runtime.mjs';

const jars = [
  String.raw`D:\QQ下载\服务器3.0\服务器3.0\.minecraft\versions\Create-Delight-Remake\mods\alexscaves-2.0.2.jar`,
  String.raw`D:\QQ下载\落幕曲\.minecraft\versions\落幕曲\mods\citadel-2.6.1-1.20.1.jar`,
  String.raw`D:\QQ下载\落幕曲\.minecraft\versions\落幕曲\mods\alexsmobs-1.22.9.jar`,
];
const targets = [
  'com.github.alexmodguy.alexscaves.client.model.FerrouslimeModel',
  'com.github.alexmodguy.alexscaves.client.model.TeletorModel',
  'com.github.alexthe666.alexsmobs.client.model.ModelTusklin',
];
const ps1 = path.join(process.cwd(), 'scripts', 'extract-class.ps1');
function extract(jar, name) {
  const tmp = path.join(os.tmpdir(), `p-${Math.random()}.class`);
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
const resolve = (n) => {
  for (const jar of jars) {
    const b = extract(jar, n);
    if (b) return b;
  }
  return null;
};
for (const cls of targets) {
  const bytes = extract(jars[0], cls) || extract(jars[2], cls);
  if (!bytes) {
    console.log(cls, 'NO CLASS');
    continue;
  }
  try {
    const m = parseJavaModelFromClass(bytes, resolve);
    const cubes = m.bones.reduce((s, b) => s + b.cubes.length, 0);
    console.log(
      cls,
      'OK',
      `${m.textureWidth}x${m.textureHeight}`,
      'bones',
      m.bones.length,
      'cubes',
      cubes,
    );
  } catch (e) {
    console.log(cls, 'FAIL', e.message);
  }
}
