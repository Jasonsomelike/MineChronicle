import fs from 'node:fs';
const p = 'scripts/java-entity-runtime.mjs';
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('MC_JAVA_DEBUG')) {
  s = s.replace(
    "    else if (op.startsWith('invoke')) {",
    `    else if (op.startsWith('invoke')) {
      if (globalThis.MC_JAVA_DEBUG) console.error('INV', op, note, 'stack', stack.length);`,
  );
  fs.writeFileSync(p, s);
  console.log('debug hook added');
} else console.log('already');
