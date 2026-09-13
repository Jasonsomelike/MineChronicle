import fs from 'node:fs';
const p = 'scripts/java-entity-runtime.mjs';
let s = fs.readFileSync(p, 'utf8');
s = s.replace(
  `    } else if (tag === 3 || tag === 4) {
      cp[i] = { tag, value: view.getInt32(o) };
      o += 4;
    }`,
  `    } else if (tag === 3) {
      cp[i] = { tag, value: view.getInt32(o) };
      o += 4;
    } else if (tag === 4) {
      cp[i] = { tag, value: view.getFloat32(o) };
      o += 4;
    }`,
);
fs.writeFileSync(p, s);
console.log(s.includes('getFloat32') ? 'float fix ok' : 'float fix missing');
