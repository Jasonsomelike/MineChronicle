import fs from 'node:fs';
const p = 'scripts/java-entity-runtime.mjs';
let s = fs.readFileSync(p, 'utf8');
s = s.replace(
  `  if (!complete || !bones.some((bone) => bone.cubes.length))
    throw new Error('No complete entity geometry');`,
  `  if (process.env.MC_JAVA_DEBUG)
    console.error('END complete', complete, 'bones', bones.length, 'cubes', bones.map((b) => b.cubes.length));
  if (!complete || !bones.some((bone) => bone.cubes.length))
    throw new Error('No complete entity geometry complete=' + complete + ' bones=' + bones.length + ' cubes=' + bones.map((b) => b.cubes.length).join(','));`,
);
fs.writeFileSync(p, s);
console.log('end debug');
