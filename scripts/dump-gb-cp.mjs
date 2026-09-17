import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseClassFile } from './java-entity-runtime.mjs';

const alex = String.raw`D:\QQ下载\落幕曲\.minecraft\versions\落幕曲\mods\alexsmobs-1.22.9.jar`;
const ps1 = path.join(process.cwd(), 'scripts', 'extract-class.ps1');
const tmp = path.join(os.tmpdir(), 'gb.class');
execFileSync(
  'powershell',
  [
    '-NoProfile',
    '-File',
    ps1,
    '-Jar',
    alex,
    '-Class',
    'com.github.alexthe666.alexsmobs.client.model.ModelGrizzlyBear',
    '-Out',
    tmp,
  ],
  { stdio: 'pipe' },
);
const parsed = parseClassFile(fs.readFileSync(tmp));
const utf = parsed.utf;
for (const e of parsed.cp) {
  if (!e) continue;
  if (
    e.tag === 1 &&
    /Model|Part|Box|tex|add|create|Cube|Mesh|Pose/.test(e.value)
  )
    console.log('U', e.value);
  if (e.tag === 10 || e.tag === 11 || e.tag === 9) {
    const nat = parsed.cp[e.b];
    const cls = parsed.cp[e.a];
    const name = utf(nat?.a);
    const desc = utf(nat?.b);
    const owner = utf(cls?.value);
    if (name && /init|add|tex|create|set|Part|Box|Cube/.test(name))
      console.log('M', owner, name, desc);
  }
}
