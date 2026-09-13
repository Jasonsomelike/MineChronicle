import fs from 'node:fs';
const p = 'scripts/java-entity-runtime.mjs';
let s = fs.readFileSync(p, 'utf8');
const bad = s.indexOf('console.error(PUSH');
if (bad >= 0) {
  const end = s.indexOf('\n', bad);
  s =
    s.slice(0, bad) +
    "console.error('PUSH', receiver && receiver.type, receiver && receiver.cubes && receiver.cubes.length);" +
    s.slice(end);
  fs.writeFileSync(p, s);
  console.log('fixed push log');
} else console.log('no bad push log');
