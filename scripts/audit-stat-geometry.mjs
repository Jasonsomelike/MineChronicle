import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { createEntityObject } from './stat-entity-renderer.mjs';

const manifest = JSON.parse(
  fs
    .readFileSync('.local/stat-textures/manifest.json', 'utf8')
    .replace(/^\uFEFF/, ''),
);
const material = new THREE.MeshBasicMaterial();
const checked = new Map(),
  failures = [],
  warnings = [];
for (const [id, job] of Object.entries(manifest)) {
  for (const part of job.entityParts ??
    (job.entityModel ? [{ entityModel: job.entityModel }] : [])) {
    const model = part.entityModel;
    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify(model))
      .digest('hex');
    if (checked.has(hash)) {
      checked.get(hash).identities.push(id);
      continue;
    }
    const record = { identities: [id], bones: model.bones.length, cubes: 0 };
    checked.set(hash, record);
    let object;
    try {
      if (!(model.textureWidth > 0 && model.textureHeight > 0))
        throw Error('Invalid texture dimensions');
      object = createEntityObject(model, material);
      object.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(object);
      const size = box.getSize(new THREE.Vector3()).toArray();
      if (size.some((v) => !Number.isFinite(v)) || size.every((v) => v === 0))
        throw Error('Empty or nonfinite bounds');
      record.size = size;
      const signatures = new Set();
      object.traverse((child) => {
        if (!child.isMesh) return;
        record.cubes++;
        const position = child.geometry.getAttribute('position');
        const world = [];
        for (let i = 0; i < position.count; i++)
          world.push(
            new THREE.Vector3()
              .fromBufferAttribute(position, i)
              .applyMatrix4(child.matrixWorld)
              .toArray()
              .map((v) => +v.toFixed(5)),
          );
        const signature = JSON.stringify(world);
        if (signatures.has(signature))
          warnings.push({
            id,
            reason: 'Coincident geometry',
            bone: child.parent.name,
          });
        signatures.add(signature);
      });
    } catch (error) {
      failures.push({ id, error: error.message });
    } finally {
      object?.traverse((child) => child.geometry?.dispose());
    }
  }
}
material.dispose();
const report = {
  uniqueModels: checked.size,
  failures,
  warnings,
  models: [...checked.values()],
};
fs.writeFileSync(
  '.local/stat-geometry-audit-0107.json',
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify({ ...report, models: undefined }, null, 2));
if (failures.length) process.exitCode = 1;
