// Original cuboids, UVs and t=0 render pose from Mojang's Java models.
// Source: mahtomedi/minecraft@6ac5fe18be48a7395be84148be051908111d6772,
// BlazeModel.createBodyLayer/setupAnim and EnderDragonRenderer.createBodyLayer/
// DragonModel.renderToBuffer/renderSide. No world/entity code is executed.
export function applyVanillaPoses(entities) {
  const cube = (origin, size, uv, extra = {}) => ({
    origin,
    size,
    uv,
    ...extra,
  });
  // ChickenModel.createBodyLayer uses a local body rotation, not a rotation
  // around the world's origin (which detached the torso from the head).
  entities.chicken.model = {
    format: 'java',
    textureWidth: 64,
    textureHeight: 32,
    bones: [
      {
        name: 'head',
        pivot: [0, 15, -4],
        cubes: [cube([-2, -6, -2], [4, 6, 3], [0, 0])],
      },
      {
        name: 'beak',
        pivot: [0, 15, -4],
        cubes: [cube([-2, -4, -4], [4, 2, 2], [14, 0])],
      },
      {
        name: 'red_thing',
        pivot: [0, 15, -4],
        cubes: [cube([-1, -2, -3], [2, 2, 2], [14, 4])],
      },
      {
        name: 'body',
        pivot: [0, 16, 0],
        rotation: [Math.PI / 2, 0, 0],
        cubes: [cube([-3, -4, -3], [6, 8, 6], [0, 9])],
      },
      ...[-2, 1].map((x, i) => ({
        name: `leg${i}`,
        pivot: [x, 19, 1],
        cubes: [cube([-1, 0, -3], [3, 5, 3], [26, 0])],
      })),
      {
        name: 'right_wing',
        pivot: [-4, 13, 0],
        cubes: [cube([0, 0, -3], [1, 4, 6], [24, 13])],
      },
      {
        name: 'left_wing',
        pivot: [4, 13, 0],
        cubes: [cube([-1, 0, -3], [1, 4, 6], [24, 13])],
      },
    ],
  };
  entities.chicken.source =
    'Mojang ChickenModel.createBodyLayer (original local body pivot)';
  const blaze = {
    format: 'java',
    textureWidth: 64,
    textureHeight: 32,
    bones: [
      {
        name: 'head',
        pivot: [0, 0, 0],
        cubes: [cube([-4, -4, -4], [8, 8, 8], [0, 0])],
      },
    ],
  };
  for (let i = 0; i < 12; i++) {
    const ring = Math.floor(i / 4);
    const angle = [0, Math.PI / 4, 0.47123894][ring] + (i % 4);
    const radius = [9, 7, 5][ring];
    const y = [-2, 2, 11][ring] + Math.cos(i * (ring === 2 ? 0.75 : 0.5));
    blaze.bones.push({
      name: `rod${i}`,
      pivot: [Math.cos(angle) * radius, y, Math.sin(angle) * radius],
      cubes: [cube([0, 0, 0], [2, 8, 2], [0, 16])],
    });
  }
  entities.blaze.model = blaze;
  entities.blaze.source = 'Mojang BlazeModel.createBodyLayer + setupAnim (t=0)';

  const bones = [];
  const add = (name, pivot, cubes, parent, rotation = [0, 0, 0]) =>
    bones.push({ name, pivot, cubes, ...(parent ? { parent } : {}), rotation });
  add(
    'body',
    [0, 4, 8],
    [
      cube([-12, 0, -16], [24, 24, 64], [0, 0]),
      ...[-10, 10, 30].map((z) => cube([-1, -6, z], [2, 6, 12], [220, 53])),
    ],
  );
  const neckCubes = [
    cube([-5, -5, -5], [10, 10, 10], [192, 104]),
    cube([-1, -9, -3], [2, 4, 6], [48, 0]),
  ];
  let y = 20,
    z = -12;
  for (let i = 0; i < 5; i++) {
    const pitch = Math.cos(i * 0.45) * 0.15;
    add(`neck${i}`, [0, y, z], structuredClone(neckCubes), undefined, [
      pitch,
      0,
      0,
    ]);
    y += Math.sin(pitch) * 10;
    z -= Math.cos(pitch) * 10;
  }
  add(
    'head',
    [0, y, z],
    [
      cube([-6, -1, -24], [12, 5, 16], [176, 44]),
      cube([-8, -8, -10], [16, 16, 16], [112, 30]),
      cube([-5, -12, -4], [2, 4, 6], [0, 0], { mirror: true }),
      cube([-5, -3, -22], [2, 2, 4], [112, 0], { mirror: true }),
      cube([3, -12, -4], [2, 4, 6], [0, 0], { mirror: true }),
      cube([3, -3, -22], [2, 2, 4], [112, 0], { mirror: true }),
    ],
  );
  add(
    'jaw',
    [0, 4, -8],
    [cube([-6, 0, -16], [12, 4, 16], [176, 65])],
    'head',
    [0.2, 0, 0],
  );
  const bob = ((Math.sin(-1) + 1) ** 2 + (Math.sin(-1) + 1) * 2) * 0.05;
  for (const [side, sign] of [
    ['left', 1],
    ['right', -1],
  ]) {
    const mirror = sign === 1;
    add(
      `${side}_wing`,
      [sign * 12, 5, 2],
      [
        cube([sign === 1 ? 0 : -56, -4, -4], [56, 8, 8], [112, 88], { mirror }),
        cube([sign === 1 ? 0 : -56, 0, 2], [56, 0, 56], [-56, 88], { mirror }),
      ],
      undefined,
      [-0.075, -sign * 0.25, -sign * 0.1],
    );
    add(
      `${side}_wing_tip`,
      [sign * 56, 0, 0],
      [
        cube([sign === 1 ? 0 : -56, -2, -2], [56, 4, 4], [112, 136], {
          mirror,
        }),
        cube([sign === 1 ? 0 : -56, 0, 2], [56, 0, 56], [-56, 144], { mirror }),
      ],
      `${side}_wing`,
      [0, 0, sign * (Math.sin(2) + 0.5) * 0.75],
    );
    add(
      `${side}_front_leg`,
      [sign * 12, 20, 2],
      [cube([-4, -4, -4], [8, 24, 8], [112, 104])],
      undefined,
      [1.3 + bob * 0.1, 0, 0],
    );
    add(
      `${side}_front_tip`,
      [0, 20, -1],
      [cube([-3, -1, -3], [6, 24, 6], [226, 138])],
      `${side}_front_leg`,
      [-0.5 - bob * 0.1, 0, 0],
    );
    add(
      `${side}_front_foot`,
      [0, 23, 0],
      [cube([-4, 0, -12], [8, 4, 16], [144, 104])],
      `${side}_front_tip`,
      [0.75 + bob * 0.1, 0, 0],
    );
    add(
      `${side}_hind_leg`,
      [sign * 16, 16, 42],
      [cube([-8, -4, -8], [16, 32, 16], [0, 0])],
      undefined,
      [1 + bob * 0.1, 0, 0],
    );
    add(
      `${side}_hind_tip`,
      [0, 32, -4],
      [cube([-6, -2, 0], [12, 32, 12], [196, 0])],
      `${side}_hind_leg`,
      [0.5 + bob * 0.1, 0, 0],
    );
    add(
      `${side}_hind_foot`,
      [0, 31, 4],
      [cube([-9, 0, -20], [18, 6, 24], [112, 0])],
      `${side}_hind_tip`,
      [0.75 + bob * 0.1, 0, 0],
    );
  }
  y = 10;
  z = 60;
  let pitch = 0;
  for (let i = 0; i < 12; i++) {
    pitch += Math.sin(i * 0.45) * 0.05;
    add(`tail${i}`, [0, y, z], structuredClone(neckCubes), undefined, [
      pitch,
      Math.PI,
      0,
    ]);
    y += Math.sin(pitch) * 10;
    z += Math.cos(pitch) * 10;
  }
  entities.ender_dragon.model = {
    format: 'java',
    textureWidth: 256,
    textureHeight: 256,
    bones,
  };
  entities.ender_dragon.source =
    'Mojang EnderDragonRenderer.createBodyLayer + DragonModel.renderToBuffer (t=0, straight flight)';
}
