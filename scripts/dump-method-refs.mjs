import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseClassFile } from './java-entity-runtime.mjs';

const jar = process.argv[2];
const className = process.argv[3];
const ps1 = path.join(process.cwd(), 'scripts', 'extract-class.ps1');
const tmp = path.join(os.tmpdir(), `dm-${Date.now()}.class`);
execFileSync(
  'powershell',
  ['-NoProfile', '-File', ps1, '-Jar', jar, '-Class', className, '-Out', tmp],
  { stdio: 'pipe' },
);
const p = parseClassFile(fs.readFileSync(tmp));
console.log('super', p.superName);
for (const e of p.cp) {
  if (!e) continue;
  if (e.tag === 10 || e.tag === 11 || e.tag === 9) {
    const nat = p.cp[e.b];
    const cls = p.cp[e.a];
    const name = p.utf(nat?.a);
    const owner = p.utf(cls?.value);
    if (name && /add|create|Part|Box|Mesh|tex|Pose|Child|Layer/i.test(name))
      console.log('M', owner, name, p.utf(nat?.b));
  }
}
