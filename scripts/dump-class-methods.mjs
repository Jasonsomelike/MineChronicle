import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseClassFile } from './java-entity-runtime.mjs';

const jar = process.argv[2];
const className = process.argv[3];
const extractPs1 = path.join(process.cwd(), 'scripts', 'extract-class.ps1');
const tmp = path.join(os.tmpdir(), `dump-${Date.now()}.class`);
execFileSync(
  'powershell',
  ['-NoProfile', '-File', extractPs1, '-Jar', jar, '-Class', className, '-Out', tmp],
  { stdio: 'pipe' },
);
const parsed = parseClassFile(fs.readFileSync(tmp));
console.log('className', parsed.className, 'super', parsed.superName);
console.log('methods', parsed.methods.map((m) => `${m.name}${m.desc}`).slice(0, 20));
// Re-decode by importing decode via a side channel: print method names containing create/add
console.log(
  'layerish',
  parsed.methods.filter((m) => /create|Layer|Part/.test(m.name)).map((m) => m.name + m.desc),
);
