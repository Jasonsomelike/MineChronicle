import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyVanillaPoses } from './stat-vanilla-poses.mjs';
import { createEntityObject } from './stat-entity-renderer.mjs';
const entities = { chicken: {}, blaze: {}, ender_dragon: {} };
applyVanillaPoses(entities);
const rods = entities.blaze.model.bones.filter((b) => b.name.startsWith('rod'));
assert.equal(rods.length, 12);
assert.equal(new Set(rods.map((b) => JSON.stringify(b.pivot))).size, 12);
assert.deepEqual(
  rods.map((b) => b.cubes[0].size),
  Array.from({ length: 12 }, () => [2, 8, 2]),
);
const dragon = entities.ender_dragon.model;
assert.equal(dragon.bones.filter((b) => b.name.startsWith('neck')).length, 5);
assert.equal(dragon.bones.filter((b) => b.name.startsWith('tail')).length, 12);
for (const side of ['left', 'right']) {
  assert.equal(
    dragon.bones.find((b) => b.name === `${side}_wing_tip`).parent,
    `${side}_wing`,
  );
  assert.equal(
    dragon.bones.find((b) => b.name === `${side}_front_foot`).parent,
    `${side}_front_tip`,
  );
}
const material = new THREE.MeshBasicMaterial();
assert.throws(
  () =>
    createEntityObject(
      {
        format: 'java',
        bones: [
          { name: 'a', parent: 'b', cubes: [] },
          { name: 'b', parent: 'c', cubes: [] },
          { name: 'c', parent: 'a', cubes: [] },
        ],
      },
      material,
    ),
  /Cyclic/,
);
assert.throws(
  () =>
    createEntityObject(
      {
        format: 'java',
        bones: [{ name: 'invalid', pivot: [0, null, 0], cubes: [] }],
      },
      material,
    ),
  /Invalid entity bone/,
);
for (const entry of Object.values(entities)) {
  const object = createEntityObject(entry.model, material);
  const bounds = new THREE.Box3().setFromObject(object);
  assert.ok(!bounds.isEmpty());
  assert.ok(bounds.min.toArray().every(Number.isFinite));
  object.traverse((child) => child.geometry?.dispose());
}
material.dispose();
console.log(
  'Pose checks passed: distinct blaze rods, complete dragon chains, cycle and nonfinite rejection.',
);
