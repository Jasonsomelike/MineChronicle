import fs from 'node:fs';
import path from 'node:path';
import { applyVanillaPoses } from './stat-vanilla-poses.mjs';

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const prismarine = read(
  '.local/prismarine-viewer/viewer/lib/entity/entities.json',
);
const result = {};
const slim = (geometry, flat = false) => ({
  format: 'bedrock',
  textureWidth:
    geometry.texturewidth ?? geometry.description?.texture_width ?? 64,
  textureHeight:
    geometry.textureheight ?? geometry.description?.texture_height ?? 64,
  bones: geometry.bones.map(
    (
      {
        name,
        parent,
        pivot,
        rotation,
        bind_pose_rotation,
        cubes,
        mirror,
        inflate,
        neverRender,
      },
      index,
    ) => ({
      name:
        flat && geometry.bones.findIndex((bone) => bone.name === name) !== index
          ? `${name}_${index}`
          : name,
      parent: flat ? undefined : parent,
      pivot,
      rotation: bind_pose_rotation ?? rotation,
      cubes,
      mirror,
      inflate,
      ...(neverRender ? { hidden: true } : {}),
    }),
  ),
});
for (const [name, entity] of Object.entries(prismarine)) {
  const geometry = entity.geometry.default ?? Object.values(entity.geometry)[0];
  const texture =
    name === 'elder_guardian'
      ? entity.textures.elder
      : entity.textures.default ?? Object.values(entity.textures)[0];
  if (!geometry?.bones || !texture) continue;
  result[name] = {
    model: slim(geometry, true),
    texture: `minecraft:${texture.replace(/^textures\//, '')}`,
    source:
      'PrismarineJS/prismarine-viewer@9e58a658aaeda34a8400210e4f0f583259a33aee > viewer/lib/entity/entities.json',
  };
  if (name === 'sheep' || name === 'stray' || name === 'slime') {
    const parts =
      name === 'sheep'
        ? ['sheared', 'default']
        : name === 'stray'
        ? ['default', 'overlay']
        : ['default', 'armor'];
    result[name].parts = parts.map((part) => ({
      model: slim(entity.geometry[part], true),
      texture: `minecraft:${(
        entity.textures[part] ?? entity.textures.default
      ).replace(/^textures\//, '')}`,
    }));
    // Bedrock combines wool below the skin; Java has a separate 64x32 wool PNG.
    if (name === 'sheep')
      for (const bone of result[name].parts[1].model.bones)
        for (const cube of bone.cubes ?? [])
          cube.uv = [cube.uv[0], cube.uv[1] - 32];
  }
}
const bedrock = '.local/bedrock-samples/resource_pack';
const geometries = new Map();
for (const file of fs.readdirSync(`${bedrock}/models/entity`)) {
  if (!file.endsWith('.json')) continue;
  const document = read(`${bedrock}/models/entity/${file}`);
  for (const geometry of document['minecraft:geometry'] ?? [])
    geometries.set(geometry.description.identifier, { geometry, file });
}
for (const file of fs.readdirSync(`${bedrock}/entity`)) {
  if (!file.endsWith('.json')) continue;
  const entity = read(`${bedrock}/entity/${file}`)['minecraft:client_entity']
    ?.description;
  const name = entity?.identifier?.replace(/^minecraft:/, '');
  if (!name || result[name]) continue;
  const geometry = geometries.get(entity.geometry?.default);
  const texture =
    entity.textures?.default ?? Object.values(entity.textures ?? {})[0];
  if (!geometry || !texture) continue;
  result[name] = {
    model: slim(geometry.geometry),
    texture: `minecraft:${texture.replace(/^textures\//, '')}`,
    source: `Mojang/bedrock-samples@736072450c26a7c67f07b1661f29d9a5ebaa14b1 > resource_pack/models/entity/${geometry.file}`,
  };
}
// Java's Enderman rest pose differs from the Bedrock animated base geometry.
// The legacy witch definition contains only additions to the villager mesh.
const witchParts = new Map(
  result.villager.model.bones.map((b) => [b.name, structuredClone(b)]),
);
for (const bone of result.witch.model.bones) witchParts.set(bone.name, bone);
result.witch.model.bones = [...witchParts.values()];
result.zombie_villager.texture =
  'minecraft:entity/zombie_villager/zombie_villager';
result.ocelot.texture = 'minecraft:entity/cat/ocelot';
// Java changed horse UVs to 64x64. Retain both layouts and select by the
// installed skin dimensions, instead of mapping modern skins to old UVs.
result.horse.modernModel = slim(
  read(`${bedrock}/models/entity/horse_v3.geo.json`)['minecraft:geometry'][0],
);
for (const bone of result.horse.modernModel.bones)
  if (/saddle|rein|bit|bridle|bag|muleear/i.test(bone.name)) bone.hidden = true;
for (const species of ['donkey', 'mule']) {
  if (!result[species]) continue;
  result[species].modernModel = structuredClone(result.horse.modernModel);
  for (const bone of result[species].modernModel.bones) {
    if (/^Ear[LR]$/.test(bone.name)) bone.hidden = true;
    if (/^MuleEar[LR]$/.test(bone.name)) bone.hidden = false;
  }
}
// These cuboids and UVs are the original EndermanModel.createBodyLayer definition.
const enderman = result.enderman;
enderman.model = {
  format: 'java',
  textureWidth: 64,
  textureHeight: 32,
  bones: [
    {
      name: 'head',
      pivot: [0, -13, 0],
      cubes: [{ origin: [-4, -8, -4], size: [8, 8, 8], uv: [0, 0] }],
    },
    {
      name: 'hat',
      pivot: [0, -13, 0],
      cubes: [
        { origin: [-4, -8, -4], size: [8, 8, 8], uv: [0, 16], inflate: -0.5 },
      ],
    },
    {
      name: 'body',
      pivot: [0, -14, 0],
      cubes: [{ origin: [-4, 0, -2], size: [8, 12, 4], uv: [32, 16] }],
    },
    {
      name: 'right_arm',
      pivot: [-5, -12, 0],
      cubes: [{ origin: [-1, -2, -1], size: [2, 30, 2], uv: [56, 0] }],
    },
    {
      name: 'left_arm',
      pivot: [5, -12, 0],
      mirror: true,
      cubes: [{ origin: [-1, -2, -1], size: [2, 30, 2], uv: [56, 0] }],
    },
    {
      name: 'right_leg',
      pivot: [-2, -5, 0],
      cubes: [{ origin: [-1, 0, -1], size: [2, 30, 2], uv: [56, 0] }],
    },
    {
      name: 'left_leg',
      pivot: [2, -5, 0],
      mirror: true,
      cubes: [{ origin: [-1, 0, -1], size: [2, 30, 2], uv: [56, 0] }],
    },
  ],
};
enderman.source =
  'Minecraft EndermanModel.createBodyLayer > mahtomedi/minecraft@6ac5fe18be48a7395be84148be051908111d6772';
enderman.parts = [
  { model: enderman.model, texture: enderman.texture },
  { model: enderman.model, texture: 'minecraft:entity/enderman/enderman_eyes' },
];
// The game's render controller hides this alternate shell while unrolled.
for (const bone of result.armadillo.model.bones)
  if (bone.name === 'body_rolled_up') bone.hidden = true;
result.illusioner = {
  ...structuredClone(result.evoker),
  texture: 'minecraft:entity/illager/illusioner',
};
result.trader_llama = structuredClone(result.llama);
// GuardianModel.createBodyLayer fixes the spike origins and tail chain at t=0.
const cube = (origin, size, uv, extra = {}) => ({ origin, size, uv, ...extra });
const guardian = {
  format: 'java',
  textureWidth: 64,
  textureHeight: 64,
  bones: [
    {
      name: 'head',
      pivot: [0, 0, 0],
      cubes: [
        cube([-6, 10, -8], [12, 12, 16], [0, 0]),
        cube([-8, 10, -6], [2, 12, 12], [0, 28]),
        cube([6, 10, -6], [2, 12, 12], [0, 28], { mirror: true }),
        cube([-6, 8, -6], [12, 2, 12], [16, 40]),
        cube([-6, 22, -6], [12, 2, 12], [16, 40]),
      ],
    },
    {
      name: 'eye',
      parent: 'head',
      pivot: [0, 0, -8.25],
      cubes: [cube([-1, 15, 0], [2, 2, 1], [8, 0])],
    },
    {
      name: 'tail0',
      parent: 'head',
      pivot: [0, 0, 0],
      cubes: [cube([-2, 14, 7], [4, 4, 8], [40, 0])],
    },
    {
      name: 'tail1',
      parent: 'tail0',
      pivot: [-1.5, 0.5, 14],
      cubes: [cube([0, 14, 0], [3, 3, 7], [0, 54])],
    },
    {
      name: 'tail2',
      parent: 'tail1',
      pivot: [0.5, 0.5, 6],
      cubes: [
        cube([0, 14, 0], [2, 2, 6], [41, 32]),
        cube([1, 10.5, 3], [1, 9, 9], [25, 19]),
      ],
    },
  ],
};
const spikePosition = [
  [0, 0, 8, -8, -8, 8, 8, -8, 0, 0, 8, -8],
  [-8, -8, -8, -8, 0, 0, 0, 0, 8, 8, 8, 8],
  [8, -8, 0, 0, -8, -8, 8, 8, 8, -8, 0, 0],
];
const spikeRotation = [
  [1.75, 0.25, 0, 0, 0.5, 0.5, 0.5, 0.5, 1.25, 0.75, 0, 0],
  [0, 0, 0, 0, 0.25, 1.75, 1.25, 0.75, 0, 0, 0, 0],
  [0, 0, 0.25, 1.75, 0, 0, 0, 0, 0, 0, 0.75, 1.25],
];
for (let i = 0; i < 12; i++)
  guardian.bones.push({
    name: `spike${i}`,
    parent: 'head',
    pivot: spikePosition.map(
      (values, axis) =>
        values[i] * (1 + Math.cos(i) * 0.01) + (axis === 1 ? 16 : 0),
    ),
    rotation: spikeRotation.map((values) => values[i] * Math.PI),
    cubes: [cube([-1, -4.5, -1], [2, 9, 2], [0, 0])],
  });
for (const name of ['guardian', 'elder_guardian']) {
  result[name].model = guardian;
  result[name].source =
    'Minecraft GuardianModel.createBodyLayer > mahtomedi/minecraft@6ac5fe18be48a7395be84148be051908111d6772';
}
applyVanillaPoses(result);
const output = 'scripts/resources/stat-vanilla-entities.json';
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(result));
for (const [source, destination] of [
  [
    '.local/prismarine-viewer/LICENSE',
    'public/resource-licenses/PrismarineJS-MIT.txt',
  ],
  [
    '.local/bedrock-samples/LICENSE.md',
    'public/resource-licenses/Mojang-bedrock-samples.txt',
  ],
])
  fs.copyFileSync(source, destination);
console.log(
  `Prepared ${Object.keys(result).length} vanilla entity model templates.`,
);
