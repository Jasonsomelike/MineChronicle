import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseJavaModelFromClass, parseClassFile } from './java-entity-runtime.mjs';

const jar = String.raw`D:\QQ下载\落幕曲\.minecraft\versions\落幕曲\mods\goety-2.5.35.1.jar`;
const ps1 = path.join(process.cwd(), 'scripts', 'extract-class.ps1');
function extract(n) {
  const t = path.join(os.tmpdir(), `g-${Math.random()}.class`);
  execFileSync(
    'powershell',
    ['-NoProfile', '-File', ps1, '-Jar', jar, '-Class', n, '-Out', t],
    { stdio: 'pipe' },
  );
  return fs.readFileSync(t);
}
const cls = 'com.Polarice3.Goety.client.render.model.CultistModel';
const bytes = extract(cls);
const p = parseClassFile(bytes);
console.log('--- all invokes ---');
for (const e of p.cp) {
  if (e?.tag === 10 || e?.tag === 11) {
    const nat = p.cp[e.b];
    const o = p.utf(p.cp[e.a]?.value);
    console.log(o, p.utf(nat?.a), p.utf(nat?.b));
  }
}
try {
  const m = parseJavaModelFromClass(bytes, (n) => {
    try {
      return extract(n);
    } catch {
      return null;
    }
  });
  console.log(
    'PARSE OK',
    m.textureWidth,
    m.textureHeight,
    'bones',
    m.bones.length,
    'cubes',
    m.bones.reduce((s, b) => s + b.cubes.length, 0),
  );
} catch (e) {
  console.log('PARSE FAIL', e.message);
}
