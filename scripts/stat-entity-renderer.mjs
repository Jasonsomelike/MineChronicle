import * as THREE from 'three';

// Cube UV conventions adapted from PrismarineJS/prismarine-viewer (MIT).
// The upstream license is retained with the bundled vanilla model definitions.
const faces = {
  up: {
    u0: [0, 0, 1],
    v0: [0, 0, 0],
    u1: [1, 0, 1],
    v1: [0, 0, 1],
    corners: [
      [0, 1, 1, 0, 0],
      [1, 1, 1, 1, 0],
      [0, 1, 0, 0, 1],
      [1, 1, 0, 1, 1],
    ],
  },
  down: {
    u0: [1, 0, 1],
    v0: [0, 0, 0],
    u1: [2, 0, 1],
    v1: [0, 0, 1],
    corners: [
      [1, 0, 1, 0, 0],
      [0, 0, 1, 1, 0],
      [1, 0, 0, 0, 1],
      [0, 0, 0, 1, 1],
    ],
  },
  east: {
    u0: [0, 0, 0],
    v0: [0, 0, 1],
    u1: [0, 0, 1],
    v1: [0, 1, 1],
    corners: [
      [1, 1, 1, 0, 0],
      [1, 0, 1, 0, 1],
      [1, 1, 0, 1, 0],
      [1, 0, 0, 1, 1],
    ],
  },
  west: {
    u0: [1, 0, 1],
    v0: [0, 0, 1],
    u1: [1, 0, 2],
    v1: [0, 1, 1],
    corners: [
      [0, 1, 0, 0, 0],
      [0, 0, 0, 0, 1],
      [0, 1, 1, 1, 0],
      [0, 0, 1, 1, 1],
    ],
  },
  north: {
    u0: [0, 0, 1],
    v0: [0, 0, 1],
    u1: [1, 0, 1],
    v1: [0, 1, 1],
    corners: [
      [1, 0, 0, 0, 1],
      [0, 0, 0, 1, 1],
      [1, 1, 0, 0, 0],
      [0, 1, 0, 1, 0],
    ],
  },
  south: {
    u0: [1, 0, 2],
    v0: [0, 0, 1],
    u1: [2, 0, 2],
    v1: [0, 1, 1],
    corners: [
      [0, 0, 1, 0, 1],
      [1, 0, 1, 1, 1],
      [0, 1, 1, 0, 0],
      [1, 1, 1, 1, 0],
    ],
  },
};
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const vector = (values = [0, 0, 0]) => new THREE.Vector3(...values);

function cubeGeometry(cube, bone, model) {
  const java = model.format === 'java';
  const positions = [],
    uvs = [],
    indices = [];
  const inflate = cube.inflate ?? bone.inflate ?? 0;
  const mirror = cube.mirror ?? bone.mirror ?? false;
  const pivot = vector(java ? [0, 0, 0] : bone.pivot);
  const cubePivot = vector(cube.pivot);
  const rotation = new THREE.Euler(
    ...(cube.rotation ?? [0, 0, 0]).map((angle) =>
      java ? angle : -THREE.MathUtils.degToRad(angle),
    ),
    java ? 'ZYX' : 'XYZ',
  );
  const [w, h, d] = cube.size;
  const [u0, v0] = cube.uv;
  // Minecraft ModelBox texOffs layout (entity models).
  const javaFaceUV = {
    down: [u0 + d, v0, w, d],
    up: [u0 + d + w, v0, w, d],
    east: [u0, v0 + d, d, h],
    north: [u0 + d, v0 + d, w, h],
    west: [u0 + d + w, v0 + d, d, h],
    south: [u0 + d + w + d, v0 + d, w, h],
  };
  for (const [direction, face] of Object.entries(faces)) {
    const perFace = !Array.isArray(cube.uv);
    const texture = perFace ? cube.uv?.[direction] : null;
    if (perFace && !texture) continue;
    const index = positions.length / 3;
    const jUV = java && !perFace ? javaFaceUV[direction] : null;
    for (const corner of face.corners) {
      const origin = vector(cube.origin);
      const point = vector(
        corner.slice(0, 3).map((coordinate, axis) => {
          const position =
            (axis === 0 && mirror) || (axis === 1 && java)
              ? 1 - coordinate
              : coordinate;
          const growth = Array.isArray(inflate) ? inflate[axis] : inflate;
          return (
            origin.getComponent(axis) +
            position * cube.size[axis] +
            (position ? growth : -growth)
          );
        }),
      );
      if (cube.rotation)
        point.sub(cubePivot).applyEuler(rotation).add(cubePivot);
      point.sub(pivot);
      positions.push(point.x, point.y, point.z);
      let u;
      let v;
      if (jUV) {
        const [ju, jv, jw, jh] = jUV;
        u = ju + corner[3] * jw;
        v = jv + corner[4] * jh;
      } else if (perFace) {
        const textureSize = texture.uv_size ?? [
          Math.abs(dot(face.u1, cube.size) - dot(face.u0, cube.size)),
          Math.abs(dot(face.v1, cube.size) - dot(face.v0, cube.size)),
        ];
        u = texture.uv[0] + corner[3] * textureSize[0];
        v = texture.uv[1] + corner[4] * textureSize[1];
      } else {
        u = cube.uv[0] + dot(corner[3] ? face.u1 : face.u0, cube.size);
        v = cube.uv[1] + dot(corner[4] ? face.v1 : face.v0, cube.size);
      }
      const scale = cube.uvScale ?? [1, 1];
      if (scale.some((value) => !Number.isFinite(value) || value <= 0))
        throw new Error('Invalid entity cube UV scale');
      uvs.push(
        u / (model.textureWidth * scale[0]),
        v / (model.textureHeight * scale[1]),
      );
    }
    indices.push(index, index + 1, index + 2, index + 2, index + 1, index + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createEntityObject(model, material) {
  const definitions = new Map(model.bones.map((bone) => [bone.name, bone]));
  for (const bone of model.bones) {
    const seen = new Set([bone.name]);
    let parent = bone.parent;
    while (parent) {
      if (seen.has(parent))
        throw new Error(`Cyclic entity bone parent ${parent}`);
      seen.add(parent);
      parent = definitions.get(parent)?.parent;
    }
    for (const values of [bone.pivot, bone.rotation, bone.scale])
      if (
        values &&
        (values.length !== 3 || values.some((v) => !Number.isFinite(v)))
      )
        throw new Error(`Invalid entity bone vector ${bone.name}`);
    for (const cube of bone.cubes ?? [])
      for (const values of [cube.origin, cube.size])
        if (
          !values ||
          values.length !== 3 ||
          values.some((v) => !Number.isFinite(v))
        )
          throw new Error(`Invalid entity cube ${bone.name}`);
  }
  const object = new THREE.Group();
  const java = model.format === 'java';
  const bones = new Map();
  if (java) {
    object.scale.y = -1;
    object.position.y = 24;
  }
  for (const bone of model.bones) {
    if (bones.has(bone.name))
      throw new Error(`Duplicate entity bone ${bone.name}`);
    const group = new THREE.Group();
    group.name = bone.name;
    group.position.copy(vector(bone.pivot));
    if (Array.isArray(bone.scale)) group.scale.fromArray(bone.scale);
    group.rotation.set(
      ...(bone.rotation ?? bone.bind_pose_rotation ?? [0, 0, 0]).map((angle) =>
        java ? angle : -THREE.MathUtils.degToRad(angle),
      ),
      java ? 'ZYX' : 'XYZ',
    );
    if (!bone.hidden)
      for (const raw of bone.cubes ?? []) {
        // Thin Java wings/plates collapse to invisible panels — keep a min edge.
        const cube = {
          ...raw,
          size: (raw.size ?? [1, 1, 1]).map((n) =>
            Number.isFinite(n) && Math.abs(n) < 0.45 ? Math.sign(n || 1) * 0.45 : n,
          ),
        };
        group.add(new THREE.Mesh(cubeGeometry(cube, bone, model), material));
      }
    bones.set(bone.name, group);
  }
  for (const bone of model.bones) {
    const group = bones.get(bone.name);
    const parent = bone.parent ? bones.get(bone.parent) : object;
    if (!parent || parent === group)
      throw new Error(`Invalid entity bone parent ${bone.parent}`);
    if (!java && bone.parent)
      group.position.sub(
        vector(
          model.bones.find((candidate) => candidate.name === bone.parent).pivot,
        ),
      );
    parent.add(group);
  }
  return object;
}

/** If a skin is mostly transparent, repack the opaque bbox so UV samples stay visible. */
async function densifySkinTexture(source) {
  try {
    const img = source.image;
    if (!img || typeof document === 'undefined') return source;
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let minX = width,
      minY = height,
      maxX = -1,
      maxY = -1,
      opaque = 0;
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1)
        if (data[(y * width + x) * 4 + 3] > 8) {
          opaque += 1;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
    const coverage = opaque / (width * height || 1);
    if (maxX < 0 || coverage === 0) {
      // Fully transparent skin — keep geometry visible with a neutral fill.
      const solid = document.createElement('canvas');
      solid.width = 16;
      solid.height = 16;
      const sctx = solid.getContext('2d');
      sctx.fillStyle = '#9aa0a8';
      sctx.fillRect(0, 0, 16, 16);
      const solidTex = new THREE.CanvasTexture(solid);
      solidTex.needsUpdate = true;
      return solidTex;
    }
    if (coverage > 0.35) return source;
    const cropW = Math.max(1, maxX - minX + 1);
    const cropH = Math.max(1, maxY - minY + 1);
    const out = document.createElement('canvas');
    out.width = Math.max(16, cropW);
    out.height = Math.max(16, cropH);
    const octx = out.getContext('2d');
    octx.imageSmoothingEnabled = false;
    octx.drawImage(canvas, minX, minY, cropW, cropH, 0, 0, out.width, out.height);
    const next = new THREE.CanvasTexture(out);
    next.needsUpdate = true;
    return next;
  } catch {
    return source;
  }
}

export async function renderEntity(job, renderer) {
  const textures = [],
    materials = [];
  const display = new THREE.Group();
  try {
    for (const part of job.entityParts ?? [
      { entityModel: job.entityModel, layer: 0 },
    ]) {
      const raw = await new THREE.TextureLoader().loadAsync(
        job.layers[part.layer].startsWith('data:')
          ? job.layers[part.layer]
          : `/.local/stat-frames/${job.layers[part.layer]}`,
      );
      // Entity skins that are mostly transparent make UV boxes vanish.
      // Crop the opaque region and use that as the sampling texture.
      const texture = await densifySkinTexture(raw);
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.encoding = THREE.sRGBEncoding;
      texture.flipY = false;
      textures.push(texture);
      const material = new THREE.MeshLambertMaterial({
        map: texture,
        side: THREE.DoubleSide,
        // Densified skins are opaque; skip discard so tiny UVs still draw.
        alphaTest: 0,
        transparent: false,
        depthWrite: part.depthWrite ?? true,
      });
      materials.push(material);
      display.add(createEntityObject(part.entityModel, material));
    }
    display.rotation.set(
      ...(job.rotation ?? [15, 155, 0]).map(THREE.MathUtils.degToRad),
    );
    display.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(display);
    const extent = bounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(extent.length()) || extent.length() === 0)
      throw new Error('Entity has no visible geometry');
    display.position.sub(bounds.getCenter(new THREE.Vector3()));
    // Frame using the dominant horizontal axis so thin insects don't fill the view.
    const half = Math.max(extent.x, extent.y, extent.z * 0.35) * 0.52;
    const camera = new THREE.OrthographicCamera(
      -half,
      half,
      half,
      -half,
      0.1,
      Math.max(1000, extent.z * 5),
    );
    camera.position.set(0, 0, Math.max(100, extent.z * 2));
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.35));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(-3, 7, 5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.55);
    fill.position.set(4, 2, -3);
    scene.add(fill, display);
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png').split(',')[1];
  } finally {
    display.traverse((child) => {
      if (child.isMesh) child.geometry.dispose();
    });
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
  }
}
