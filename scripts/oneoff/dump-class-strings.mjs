import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const jar = process.argv[2];
const className = process.argv[3];
const ps1 = path.join(process.cwd(), 'scripts', 'extract-class.ps1');
const tmp = path.join(os.tmpdir(), `str-${Date.now()}.class`);
execFileSync(
  'powershell',
  ['-NoProfile', '-File', ps1, '-Jar', jar, '-Class', className, '-Out', tmp],
  { stdio: 'pipe' },
);
const buf = fs.readFileSync(tmp);
const text = buf.toString('latin1');
const hits = [...text.matchAll(/textures\/[a-z0-9_/.-]+/gi)].map((m) => m[0]);
console.log([...new Set(hits)].join('\n'));
