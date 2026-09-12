import fs from 'node:fs';
import assert from 'node:assert/strict';
import { readLayerModel } from './stat-entity-layer.mjs';
import { parseJavaModel } from './stat-entity-java.mjs';
const bindings = JSON.parse(
  fs.readFileSync('.local/stat-discovered-bindings.json', 'utf8'),
);
for (const [id, name, minBones] of [
  ['hmag:harpy', 'com.github.mechalopa.hmag.client.model.HarpyModel', 20],
  ['hmag:lich', 'com.github.mechalopa.hmag.client.model.LichModel', 10],
  ['artifacts:mimic', 'artifacts.client.mimic.model.MimicModel', 3],
  [
    'twilightforest:minotaur',
    'twilightforest.client.model.entity.MinotaurModel',
    10,
  ],
]) {
  const candidates = Object.entries(bindings)
    .filter(([key]) => key.endsWith(`|${id}`))
    .flatMap(([, v]) => v);
  const binding = candidates.find((b) =>
    b.classes?.includes(name.replaceAll('.', '/') + '.class'),
  );
  assert.ok(binding, `Missing installed fixture ${id}`);
  const model = readLayerModel(binding.jar, name, { method: 'auto' });
  assert.ok(model.bones.length >= minBones, id);
  for (const bone of model.bones) {
    assert.ok(bone.pivot.every(Number.isFinite), `${id} ${bone.name} pivot`);
    assert.ok(
      bone.rotation.every(Number.isFinite),
      `${id} ${bone.name} rotation`,
    );
    for (const cube of bone.cubes ?? [])
      assert.ok(
        cube.size.every((v) => Number.isFinite(v) && v >= 0),
        `${id} cube`,
      );
  }
  console.log(`${id}: ${model.bones.length} valid bones`);
}
const source = fs.readFileSync(
  '.local/classes-0107/com.github.L_Ender.cataclysm.client.model.entity.Wadjet_Model.txt',
  'utf8',
);
const wadjet = parseJavaModel(
  source,
  'com.github.L_Ender.cataclysm.client.model.entity.Wadjet_Model',
);
assert.ok(wadjet.bones.length > 10, 'Wadjet tail array must be preserved');
console.log(`Wadjet array constructor: ${wadjet.bones.length} bones`);
