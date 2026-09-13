import fs from 'node:fs';
const p = 'scripts/java-entity-runtime.mjs';
// Strip debug hooks for production readability
let s = fs.readFileSync(p, 'utf8');
s = s.replace(/\n\s*if \(process\.env\.MC_JAVA_DEBUG\)[^\n]+\n/g, '\n');
s = s.replace(
  /if \(process\.env\.MC_JAVA_DEBUG\)\s+console\.error\('END'[^;]+;/,
  '',
);
s = s.replace(
  /throw new Error\('No complete entity geometry complete=' \+ complete[^\n]+\n/,
  `throw new Error('No complete entity geometry');\n`,
);
fs.writeFileSync(p, s);
console.log('debug stripped', !s.includes('MC_JAVA_DEBUG'));
