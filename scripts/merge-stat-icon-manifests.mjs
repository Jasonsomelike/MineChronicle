import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Merge a targeted export without regenerating unchanged resource packs.
// Identity is explicit: item and entity jobs must never be conflated.
const read = (file) =>
  JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const target = '.local/stat-textures';
const manifest = read(path.join(target, 'manifest.json'));
const requested = new Set(
  read('.local/stat-icon-requests.json').map(
    (row) => `${row.root}|${row.entity ? 'entity:' : ''}${row.key}`,
  ),
);
const copies = new Map();
let count = 0;
for (const directory of process.argv.slice(2)) {
  for (const [id, job] of Object.entries(
    read(path.join(directory, 'manifest.json')),
  )) {
    assert.ok(requested.has(id), `Unexpected resource identity ${id}`);
    assert.ok(['item', 'model', 'chest', 'shield'].includes(job.kind), id);
    if (id.includes('|entity:'))
      assert.ok(job.entityModel || job.entityParts, id);
    for (const layer of job.layers) {
      assert.match(layer.file, /^[a-f0-9]{64}\.png$/);
      const bytes = fs.readFileSync(path.join(directory, layer.file));
      assert.equal(
        crypto.createHash('sha256').update(bytes).digest('hex') + '.png',
        layer.file,
      );
      const output = path.join(target, layer.file);
      if (fs.existsSync(output))
        assert.ok(bytes.equals(fs.readFileSync(output)), output);
      if (copies.has(output))
        assert.ok(bytes.equals(copies.get(output)), output);
      copies.set(output, bytes);
    }
    manifest[id] = job;
    count++;
  }
}
// Validate all additions before mutating the destination.
for (const [file, bytes] of copies)
  if (!fs.existsSync(file)) fs.writeFileSync(file, bytes);
fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest));
console.log(
  JSON.stringify({ merged: count, total: Object.keys(manifest).length }),
);
