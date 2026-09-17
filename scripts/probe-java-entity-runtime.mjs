import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseJavaModelFromClass } from './java-entity-runtime.mjs';

const jar = process.argv[2];
const className = process.argv[3];
if (!jar || !className) {
  console.error(
    'usage: node scripts/probe-java-entity-runtime.mjs <jar> <className>',
  );
  process.exit(2);
}
const extractPs1 = path.join(process.cwd(), 'scripts', 'extract-class.ps1');

function extractClass(archive, name) {
  const tmp = path.join(
    os.tmpdir(),
    `mc-class-${process.pid}-${Date.now()}-${Math.random()}.class`,
  );
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      extractPs1,
      '-Jar',
      archive,
      '-Class',
      name,
      '-Out',
      tmp,
    ],
    { stdio: 'pipe' },
  );
  const bytes = fs.readFileSync(tmp);
  console.error(
    'extract',
    name,
    'len',
    bytes.length,
    'head',
    bytes.subarray(0, 8),
  );
  if (bytes.length < 8 || bytes[0] !== 0xca) {
    throw new Error(`extract failed for ${name}: len=${bytes.length}`);
  }
  return bytes;
}

try {
  const classBytes = extractClass(jar, className);
  const model = parseJavaModelFromClass(classBytes, (name) => {
    try {
      return extractClass(jar, name);
    } catch {
      return null;
    }
  });
  console.log(
    JSON.stringify(
      {
        className,
        textureWidth: model.textureWidth,
        textureHeight: model.textureHeight,
        bones: model.bones.length,
        cubes: model.bones.reduce((n, b) => n + b.cubes.length, 0),
        sample: model.bones.slice(0, 5).map((b) => ({
          name: b.name,
          pivot: b.pivot,
          cubes: b.cubes.length,
        })),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error('PARSE_FAIL', error.stack || error.message);
  process.exit(1);
}
