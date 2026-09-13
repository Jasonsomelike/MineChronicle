import fs from 'node:fs';
const path = 'src-tauri/src/minecraft/runtime_resources.rs';
let s = fs.readFileSync(path, 'utf8');
const end = s.indexOf('fn entity(index: &Index, key: &str) -> Resolution {');
if (end < 0) throw new Error('entity fn not found');
if (s.includes('fn java_model_resolution')) {
  console.log('already present');
  process.exit(0);
}
const helper = fs.readFileSync('scripts/java-rust-helpers.rs', 'utf8');
s = s.slice(0, end) + helper + '\n' + s.slice(end);
fs.writeFileSync(path, s);
console.log('inserted', helper.length, 'chars');
