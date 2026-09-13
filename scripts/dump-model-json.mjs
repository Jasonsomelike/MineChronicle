import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseJavaModelFromClass } from './java-entity-runtime.mjs';

const jar = process.argv[2];
const cls = process.argv[3];
const ps1 = path.join(process.cwd(), 'scripts', 'extract-class.ps1');
const tmp = path.join(os.tmpdir(), `dumpm-${Math.random()}.class`);
execFileSync(
  'powershell',
  ['-NoProfile', '-File', ps1, '-Jar', jar, '-Class', cls, '-Out', tmp],
  { stdio: 'pipe' },
);
const model = parseJavaModelFromClass(fs.readFileSync(tmp), (n) => {
  const t = path.join(os.tmpdir(), `p-${Math.random()}.class`);
  try {
    execFileSync(
      'powershell',
      ['-NoProfile', '-File', ps1, '-Jar', jar, '-Class', n, '-Out', t],
      { stdio: 'pipe' },
    );
    return fs.readFileSync(t);
  } catch {
    return null;
  }
});
console.log(JSON.stringify(model, null, 2));
