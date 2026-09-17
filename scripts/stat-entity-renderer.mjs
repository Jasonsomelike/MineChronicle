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
  // Drop tiny decorative bones (spines/teeth) so icon silhouettes stay readable.
  const decorative = /^(Spine|TailSpine|Tooth|JawHook|HeadInner)/i;
  const bonesSource = model.bones.filter((bone) => {
    if (!decorative.test(bone.name)) return true;
    const volume = (bone.cubes ?? []).reduce(
      (sum, cube) =>
        sum +
        Math.abs(
          (cube.size?.[0] ?? 0) * (cube.size?.[1] ?? 0) * (cube.size?.[2] ?? 0),
        ),
      0,
    );
    return volume > 8;
  });
  const model2 = { ...model, bones: bonesSource };
  const modelRef = model2;
  const definitions = new Map(modelRef.bones.map((bone) => [bone.name, bone]));
  for (const bone of modelRef.bones) {
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
  const java = modelRef.format === 'java';
  const bones = new Map();
  if (java) {
    object.scale.y = -1;
    object.position.y = 24;
  }
  for (const bone of modelRef.bones) {
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
        // Zero-thickness plates get a hair of depth for rasterization only.
        // Large in-plane plates (mosquito wings/legs ~18x15) dominate icons —
        // cap footprint so the body stays readable.
        const inflated = (raw.size ?? [1, 1, 1]).map((n) =>
          Number.isFinite(n) && n === 0 ? 0.08 : n,
        );
        const minDim = Math.min(...inflated);
        const PLATE_CAP = 7;
        const size = inflated.map((n) =>
          minDim <= 0.35 && n > PLATE_CAP ? PLATE_CAP : n,
        );
        const cube = { ...raw, size };
        group.add(new THREE.Mesh(cubeGeometry(cube, bone, modelRef), material));
      }
    bones.set(bone.name, group);
  }
  for (const bone of modelRef.bones) {
    const group = bones.get(bone.name);
    const parent = bone.parent ? bones.get(bone.parent) : object;
    if (!parent || parent === group)
      throw new Error(`Invalid entity bone parent ${bone.parent}`);
    if (!java && bone.parent)
      group.position.sub(
        vector(
          modelRef.bones.find((candidate) => candidate.name === bone.parent)
            .pivot,
        ),
      );
    parent.add(group);
  }
  return object;
}

/**
 * Entity skins are often mostly transparent with UVs in fixed atlas coords.
 * Cropping would break those UVs. Mid-density skins get a full fill so solid
 * cubes stay readable. Very sparse skins (mosquito wings, membranes) must keep
 * their transparent regions — only a thin halo is grown so wings don't become slabs.
 */
async function densifySkinTexture(source) {
  try {
    const img = source.image;
    if (!img || typeof document === 'undefined') return source;
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height,
    );
    let opaque = 0;
    let r = 0,
      g = 0,
      b = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 8) {
        opaque += 1;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
      }
    }
    const coverage = opaque / (width * height || 1);
    if (coverage > 0.5) return source;
    if (opaque === 0) return source;
    // Sparse wing/membrane skins: grow a 2px halo instead of a solid fill.
    if (coverage < 0.12) {
      const src = new Uint8ClampedArray(data);
      const radius = 2;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * 4;
          if (src[i + 3] > 8) continue;
          let br = 0,
            bg = 0,
            bb = 0,
            bn = 0;
          for (let dy = -radius; dy <= radius; dy += 1) {
            for (let dx = -radius; dx <= radius; dx += 1) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
              const j = (ny * width + nx) * 4;
              if (src[j + 3] > 8) {
                br += src[j];
                bg += src[j + 1];
                bb += src[j + 2];
                bn += 1;
              }
            }
          }
          if (bn > 0) {
            data[i] = br / bn;
            data[i + 1] = bg / bn;
            data[i + 2] = bb / bn;
            data[i + 3] = 255;
          }
        }
      }
      ctx.putImageData(new ImageData(data, width, height), 0, 0);
      const next = new THREE.CanvasTexture(canvas);
      next.needsUpdate = true;
      return next;
    }
    const fill = [r / opaque, g / opaque, b / opaque];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] <= 8) {
        data[i] = fill[0];
        data[i + 1] = fill[1];
        data[i + 2] = fill[2];
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(new ImageData(data, width, height), 0, 0);
    const next = new THREE.CanvasTexture(canvas);
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
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.DoubleSide,
        alphaTest: 0.12,
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
    // MeshBasic shows the skin as-authored; a single soft key light is faked
    // via vertex colors so forms still read without washing out browns.
    scene.add(new THREE.AmbientLight(0xffffff, 0.0));
    const key = new THREE.DirectionalLight(0xffffff, 0.0);
    key.position.set(-3, 7, 5);
    scene.add(key);
    scene.add(display);
    display.traverse((child) => {
      if (!child.isMesh || !child.geometry) return;
      const geom = child.geometry;
      const pos = geom.getAttribute('position');
      const nor = geom.getAttribute('normal');
      if (!pos || !nor || geom.getAttribute('color')) return;
      const colors = new Float32Array(pos.count * 3);
      const light = new THREE.Vector3(-0.45, 0.75, 0.55).normalize();
      for (let i = 0; i < pos.count; i += 1) {
        const nx = nor.getX(i);
        const ny = nor.getY(i);
        const nz = nor.getZ(i);
        const ndl = Math.max(0, nx * light.x + ny * light.y + nz * light.z);
        const shade = 0.72 + ndl * 0.38;
        colors[i * 3] = shade;
        colors[i * 3 + 1] = shade;
        colors[i * 3 + 2] = shade;
      }
      geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      child.material.vertexColors = true;
      child.material.needsUpdate = true;
    });
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
