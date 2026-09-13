import fs from 'node:fs';
const path = 'src-tauri/src/minecraft/runtime_resources.rs';
let s = fs.readFileSync(path, 'utf8');
const start = s.indexOf('fn java_model_resolution');
const end = s.indexOf('fn entity(index: &Index, key: &str) -> Resolution {');
if (start < 0 || end < 0) throw new Error('markers missing');
const neu = fs.readFileSync('scripts/java-rust-helpers.rs', 'utf8');
// Only replace from java_model_resolution to entity — but helpers file now has more.
// Instead replace from pascal_case to entity with full helpers file + entity
const pascal = s.indexOf('fn pascal_case');
if (pascal < 0) throw new Error('pascal missing');
const helpers = fs.readFileSync('scripts/java-rust-helpers.rs', 'utf8');
s = s.slice(0, pascal) + helpers + '\n' + s.slice(end);
fs.writeFileSync(path, s);
console.log('rewrote helpers block');
