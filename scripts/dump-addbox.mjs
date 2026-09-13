import fs from 'node:fs';
const s = fs.readFileSync('scripts/java-entity-runtime.mjs', 'utf8');
const i = s.indexOf("name === 'addBox'");
console.log(JSON.stringify(s.slice(i - 100, i + 500)));
