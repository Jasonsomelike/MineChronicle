import fs from 'node:fs';
const p = 'scripts/java-entity-runtime.mjs';
let s = fs.readFileSync(p, 'utf8');
s = s.replace(
  /\\\/\(\?:AdvancedModelBox\|AdvancedModelRenderer\|AnimatedModelRenderer\|ModelPart\)\$/,
  '(?:^|[./])(?:AdvancedModelBox|AdvancedModelRenderer|AnimatedModelRenderer|ModelPart)$',
);
// The file may have different escaping - do a simple include replace
s = s.replaceAll(
  '/(?:AdvancedModelBox|AdvancedModelRenderer|AnimatedModelRenderer|ModelPart)$/',
  '/(?:^|[./])(?:AdvancedModelBox|AdvancedModelRenderer|AnimatedModelRenderer|ModelPart)$/',
);
// That's wrong - fix to regex without extra slash
s = s.replaceAll(
  '/(?:^|[./])(?:AdvancedModelBox|AdvancedModelRenderer|AnimatedModelRenderer|ModelPart)$/',
  '/(?:^|[./])(?:AdvancedModelBox|AdvancedModelRenderer|AnimatedModelRenderer|ModelPart)$/',
);
fs.writeFileSync(p, s);
console.log('regex updated');
// show the line
const i = s.indexOf('AdvancedModelBox|');
console.log(s.slice(i - 40, i + 100));
