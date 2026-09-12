import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createEntityObject } from './stat-entity-renderer.mjs';
import { parseJavaModel } from './stat-entity-java.mjs';

const material = new THREE.MeshBasicMaterial();
const cube = { origin: [-2, -2, -2], size: [4, 4, 4], uv: [0, 0] };
const java = createEntityObject(
  {
    format: 'java',
    textureWidth: 64,
    textureHeight: 64,
    bones: [
      {
        name: 'root',
        pivot: [0, 24, 0],
        hidden: true,
        cubes: [{ ...cube, size: [100, 100, 100] }],
      },
      { name: 'child', parent: 'root', pivot: [0, -8, 0], cubes: [cube] },
    ],
  },
  material,
);
const javaBounds = new THREE.Box3().setFromObject(java);
assert.deepEqual(javaBounds.min.toArray(), [-2, 6, -2]);
assert.deepEqual(javaBounds.max.toArray(), [2, 10, 2]);

const bedrock = createEntityObject(
  {
    format: 'bedrock',
    textureWidth: 64,
    textureHeight: 64,
    bones: [
      { name: 'parent', pivot: [0, 5, 0] },
      {
        name: 'child',
        parent: 'parent',
        pivot: [0, 10, 0],
        cubes: [{ ...cube, origin: [-2, 8, -2] }],
      },
    ],
  },
  material,
);
const bedrockBounds = new THREE.Box3().setFromObject(bedrock);
assert.deepEqual(bedrockBounds.min.toArray(), [-2, 8, -2]);
assert.deepEqual(bedrockBounds.max.toArray(), [2, 12, 2]);
const scaledUvs = createEntityObject(
  {
    format: 'java',
    textureWidth: 64,
    textureHeight: 64,
    bones: [{ name: 'part', cubes: [{ ...cube, uvScale: [2, 2] }] }],
  },
  material,
);
let maximumUv = 0;
scaledUvs.traverse((child) => {
  if (child.isMesh)
    maximumUv = Math.max(...child.geometry.getAttribute('uv').array);
});
assert.equal(maximumUv, 0.125);

assert.throws(
  () =>
    createEntityObject(
      { format: 'java', bones: [{ name: 'one', parent: 'missing' }] },
      material,
    ),
  /Invalid entity bone parent/,
);
assert.throws(
  () =>
    parseJavaModel(
      'public Demo();\nCode:\n0: multianewarray\n1: return',
      'Demo',
    ),
  /Unsupported model instruction/,
);
assert.throws(
  () => parseJavaModel('public Demo();\nCode:\n0: return', 'Demo'),
  /No complete entity geometry/,
);
const inheritedConstructor = `public Child();
  Code:
    0: aload_0
    1: invokespecial #1 // Method Parent."<init>":()V
    2: return`;
assert.throws(
  () => parseJavaModel(inheritedConstructor, 'Child'),
  /Missing inherited entity geometry/,
);
const parentConstructor = `public Parent();
  Code:
    0: aload_0
    1: sipush 128
    2: putfield #1 // Field texWidth:I
    3: aload_0
    4: sipush 128
    5: putfield #2 // Field texHeight:I
    6: aload_0
    7: new #3 // class library/AdvancedModelBox
    8: dup
    9: aload_0
    10: invokespecial #4 // Method library/AdvancedModelBox."<init>":(Ljava/lang/Object;)V
    11: putfield #5 // Field body:Llibrary/AdvancedModelBox;
    12: aload_0
    13: getfield #5 // Field body:Llibrary/AdvancedModelBox;
    14: fconst_0
    15: fconst_0
    16: fconst_0
    17: fconst_2
    18: ldc #6 // float 3.0f
    19: ldc #7 // float 4.0f
    20: fconst_0
    21: iconst_0
    22: invokevirtual #8 // Method library/AdvancedModelBox.addBox:(FFFFFFFZ)V
    23: return`;
const inherited = parseJavaModel(
  inheritedConstructor,
  'Child',
  () => parentConstructor,
);
assert.equal(inherited.textureWidth, 128);
assert.equal(inherited.textureHeight, 128);
assert.deepEqual(inherited.bones[0].cubes[0].size, [2, 3, 4]);
const labelled = parentConstructor.replace(
  '10: invokespecial #4 // Method library/AdvancedModelBox."<init>":(Ljava/lang/Object;)V',
  '9: ldc #9 // String cosmeticName\n10: invokespecial #4 // Method library/AdvancedModelBox."<init>":(Ljava/lang/Object;Ljava/lang/String;)V',
);
const sibling = labelled
  .slice(labelled.indexOf('6: aload_0'), labelled.indexOf('23: return'))
  .replaceAll('Field body:', 'Field sibling:');
const duplicateLabels = parseJavaModel(
  labelled.replace('23: return', `${sibling}23: return`),
  'Parent',
);
assert.deepEqual(
  duplicateLabels.bones.map((bone) => bone.name),
  ['body', 'sibling'],
);
const angleConstructor = parentConstructor.replace(
  '23: return',
  `23: aload_0
    24: aload_0
    25: getfield #5 // Field body:Llibrary/AdvancedModelBox;
    26: ldc2_w #9 // double -23.0d
    27: invokestatic #10 // Method com/github/alexthe666/alexsmobs/entity/util/Maths.rad:(D)F
    28: fconst_0
    29: fconst_0
    30: invokevirtual #11 // Method setRotationAngle:(Llibrary/AdvancedModelBox;FFF)V
    31: return`,
);
assert.equal(
  parseJavaModel(angleConstructor, 'Parent').bones[0].rotation[0],
  Math.fround((-23 * Math.PI) / 180),
);
assert.throws(
  () =>
    parseJavaModel(
      angleConstructor.replace(
        'com/github/alexthe666/alexsmobs/entity/util/Maths.rad',
        'unrecognized/Helper.rad',
      ),
      'Parent',
    ),
  /Unsupported numeric entity call/,
);
for (const object of [java, bedrock, scaledUvs])
  object.traverse((child) => {
    if (child.isMesh) child.geometry.dispose();
  });
material.dispose();
process.stdout.write(
  'Entity geometry checks passed: Java axes, absolute Bedrock pivots, hidden parent, and explicit unsupported-model rejection.\n',
);
