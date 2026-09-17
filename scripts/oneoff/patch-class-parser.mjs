import fs from 'node:fs';
const p = 'scripts/java-entity-runtime.mjs';
let s = fs.readFileSync(p, 'utf8');
const start = s.indexOf('export function parseClassFile');
const end = s.indexOf('let o = 8;', start);
if (start < 0 || end < 0) throw new Error('markers not found');
const neu = `export function parseClassFile(input) {
  const bytes = new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = u4(view, 0);
  if (magic !== 0xcafebabe) {
    throw new Error(
      'Not a class file magic=' + magic.toString(16) + ' len=' + bytes.length,
    );
  }
  `;
s = s.slice(0, start) + neu + s.slice(end);
fs.writeFileSync(p, s);
console.log('patched ok');
