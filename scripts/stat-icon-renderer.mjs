import * as THREE from 'three';
import { BlockModelFactory } from '@xmcl/model';
import { renderObj } from './stat-icon-obj.mjs';
import { renderEntity } from './stat-entity-renderer.mjs';

const SIZE = 512;
const renderer = new THREE.WebGLRenderer({
  alpha: true,
  antialias: true,
  preserveDrawingBuffer: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
renderer.setSize(SIZE, SIZE, false);
renderer.setClearColor(0, 0);
renderer.outputEncoding = THREE.sRGBEncoding;
const batchMode = location.pathname.endsWith('/stat-icon-renderer.html');
if (batchMode) document.body.append(renderer.domElement);
const assetUrl = (file) =>
  file.startsWith('data:') ? file : `/.local/stat-frames/${file}`;
const scene = new THREE.Scene();
scene.add(new THREE.AmbientLight(0xffffff, 0.65));
const light = new THREE.DirectionalLight(0xffffff, 0.65);
light.position.set(-3, 7, 5);
scene.add(light);
const camera = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 200);
camera.position.set(0, 0, 70);
const registry = {};
const factory = new BlockModelFactory(registry);
const images = new Map();
async function image(file) {
  if (!images.has(file)) {
    const img = new Image();
    img.src = assetUrl(file);
    await img.decode();
    images.set(file, img);
  }
  return images.get(file);
}
const uv = (a) => a.map((v) => v / 4);
function entityBox(from, to, u, v, texture = 'skin') {
  const [w, h, d] = to.map((n, i) => n - from[i]);
  const face = (rectangle) => ({ uv: uv(rectangle), texture: `#${texture}` });
  return {
    from,
    to,
    faces: {
      west: face([u, v + d, u + d, v + d + h]),
      north: face([u + d, v + d, u + d + w, v + d + h]),
      east: face([u + d + w, v + d, u + 2 * d + w, v + d + h]),
      south: face([u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h]),
      up: face([u + d, v, u + d + w, v + d]),
      down: face([u + d + w, v, u + d + 2 * w, v + d]),
    },
  };
}
async function modelFor(job) {
  if (job.kind === 'chest' || job.kind === 'shield') {
    const canvas = document.createElement('canvas');
    const layers = await Promise.all(job.layers.map(image));
    canvas.width = Math.max(...layers.map((layer) => layer.width));
    canvas.height = Math.max(...layers.map((layer) => layer.height));
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = false;
    for (const layer of layers)
      context.drawImage(layer, 0, 0, canvas.width, canvas.height);
    registry[job.hash] = { url: canvas.toDataURL() };
    return {
      textures: { skin: job.hash },
      elements:
        job.kind === 'chest'
          ? [
              entityBox([1, 0, 1], [15, 10, 15], 0, 19),
              entityBox([1, 9, 1], [15, 14, 15], 0, 0),
              entityBox([7, 7, 0], [9, 11, 1], 0, 0),
            ]
          : [
              entityBox([2, -3, 6], [14, 19, 7], 0, 0),
              entityBox([7, 5, 7], [9, 11, 13], 26, 0),
            ],
      display:
        job.kind === 'chest'
          ? { rotation: [30, 225, 0] }
          : { rotation: [15, 155, -5] },
    };
  }
  const textures = {},
    elements = structuredClone(job.elements);
  for (const [id, file] of Object.entries(job.textures)) {
    const textureKey = `t${Object.keys(textures).length}`;
    textures[textureKey] = file;
    registry[file] = { url: assetUrl(file) };
    for (const element of elements)
      for (const face of Object.values(element.faces))
        if (face.texture === id) face.texture = `#${textureKey}`;
  }
  return {
    textures,
    elements,
    display: job.display ?? { rotation: [30, 225, 0] },
  };
}
async function render(job) {
  if (job.entityModel || job.entityParts) return renderEntity(job, renderer);
  if (job.obj) return renderObj(job, renderer);
  const model = await modelFor(job);
  const obj = factory.getObject(model);
  obj.displayOption = {
    gui: {
      rotation: [0, 0, 0],
      translation: [0, 0, 0],
      scale: [1, 1, 1],
      ...model.display,
    },
  };
  obj.applyDisplay('gui');
  const textures = new Set();
  obj.traverse((child) => {
    if (!child.isMesh) return;
    // Minecraft's element rescale is separate from its rotation.
    const pivot = child.parent;
    const element = model.elements[obj.children[0].children.indexOf(pivot)];
    // XMCL's partial UV rectangles use a different vertical convention. Apply
    // Minecraft's top-origin UVs and quarter turns to the generated geometry.
    const [x0, y0, z0] = element.from,
      [x1, y1, z1] = element.to;
    const defaults = {
      east: [16 - z1, 16 - y1, 16 - z0, 16 - y0],
      west: [z0, 16 - y1, z1, 16 - y0],
      up: [x0, z0, x1, z1],
      down: [x0, 16 - z1, x1, 16 - z0],
      south: [x0, 16 - y1, x1, 16 - y0],
      north: [16 - x1, 16 - y1, 16 - x0, 16 - y0],
    };
    const uvAttribute = child.geometry.getAttribute('uv');
    for (const [faceIndex, direction] of [
      'east',
      'west',
      'up',
      'down',
      'south',
      'north',
    ].entries()) {
      const face = element.faces[direction];
      if (!face) continue;
      const [u0, v0, u1, v1] = (face.uv ?? defaults[direction]).map(
        (v) => v / 16,
      );
      let corners = [
        [u0, 1 - v0],
        [u1, 1 - v0],
        [u0, 1 - v1],
        [u1, 1 - v1],
      ];
      for (let turn = 0; turn < (face.rotation ?? 0) / 90; turn++)
        corners = [corners[2], corners[0], corners[3], corners[1]];
      corners.forEach(([u, v], i) =>
        uvAttribute.setXY(faceIndex * 4 + i, u, v),
      );
    }
    uvAttribute.needsUpdate = true;
    if (element?.rotation?.rescale) {
      const factor = 1 / Math.cos((element.rotation.angle * Math.PI) / 180);
      for (const axis of ['x', 'y', 'z'])
        if (axis !== element.rotation.axis) pivot.scale[axis] = factor;
    }
    for (const material of child.material)
      if (material.map) {
        // Glass textures can be entirely below the factory's 50% alpha cutoff.
        material.alphaTest = 1 / 255;
        material.map.magFilter = THREE.NearestFilter;
        material.map.minFilter = THREE.NearestFilter;
        material.map.generateMipmaps = false;
        material.map.encoding = THREE.sRGBEncoding;
        textures.add(material.map);
      }
  });
  await Promise.all(
    [...textures].map((texture) =>
      texture.image?.complete
        ? Promise.resolve()
        : new Promise((resolve, reject) => {
            const started = performance.now();
            const timer = setInterval(() => {
              if (texture.image?.complete) {
                clearInterval(timer);
                resolve();
              } else if (performance.now() - started > 10000) {
                clearInterval(timer);
                reject(new Error('Texture did not load'));
              }
            }, 5);
          }),
    ),
  );
  scene.add(obj);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj),
    center = box.getCenter(new THREE.Vector3()),
    extent = box.getSize(new THREE.Vector3());
  obj.position.sub(center);
  // Fit the complete inventory model with a small stable border.
  const half = (Math.max(extent.x, extent.y) / 2) * 1.12;
  camera.left = -half;
  camera.right = half;
  camera.top = half;
  camera.bottom = -half;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  const png = renderer.domElement.toDataURL('image/png').split(',')[1];
  scene.remove(obj);
  obj.traverse((child) => {
    if (child.isMesh) child.geometry.dispose();
  });
  return png;
}
export async function renderRuntime(job) {
  try {
    if (job.javaModel?.className && job.javaModel.classes) {
      const { parseJavaModelFromClass } = await import('./java-entity-runtime.mjs');
      const decode = (b64) => {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
        return out;
      };
      const classes = {};
      for (const [name, b64] of Object.entries(job.javaModel.classes))
        classes[name] = decode(b64);
      const model = parseJavaModelFromClass(
        classes[job.javaModel.className],
        (n) => classes[n] ?? null,
      );
      job.entityModel = {
        format: 'java',
        textureWidth: job.textureWidth || model.textureWidth,
        textureHeight: job.textureHeight || model.textureHeight,
        bones: model.bones,
      };
      if (job.renderSize && job.renderSize !== SIZE) {
        renderer.setSize(job.renderSize, job.renderSize, false);
      }
    }
    if (job.kind === 'frame' && job.frameHeight && job.layers?.[0]) {
      const source = await image(job.layers[0]);
      const height = Math.max(1, Math.min(job.frameHeight, source.height));
      const canvas = document.createElement('canvas');
      canvas.width = source.width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      context.imageSmoothingEnabled = false;
      context.drawImage(source, 0, 0, source.width, height, 0, 0, canvas.width, canvas.height);
      return {
        image: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height,
        kind: 'item',
      };
    }
    if (job.kind === 'portrait' && job.layers?.[0]) {
      const source = await image(job.layers[0]);
      const c = document.createElement('canvas');
      c.width = source.width;
      c.height = source.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(source, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
      let minX = width, minY = height, maxX = -1, maxY = -1;
      for (let y = 0; y < height; y += 1)
        for (let x = 0; x < width; x += 1)
          if (data[(y * width + x) * 4 + 3] > 8) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
      if (maxX < 0) { minX = 0; minY = 0; maxX = width - 1; maxY = height - 1; }
      const pad = Math.max(1, Math.floor(Math.max(maxX - minX, maxY - minY) * 0.08));
      minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
      maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
      const side = Math.max(maxX - minX + 1, maxY - minY + 1);
      const outSize = SIZE;
      const out = document.createElement('canvas');
      out.width = outSize; out.height = outSize;
      const octx = out.getContext('2d');
      octx.imageSmoothingEnabled = false;
      const ox = minX - Math.floor((side - (maxX - minX + 1)) / 2);
      const oy = minY - Math.floor((side - (maxY - minY + 1)) / 2);
      octx.drawImage(c, ox, oy, side, side, 0, 0, outSize, outSize);
      return { image: out.toDataURL('image/png'), width: outSize, height: outSize, kind: 'item' };
    }
    if (job.layers && !job.entityModel && !job.entityParts) {
      const layers = await Promise.all(job.layers.map(image));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(...layers.map((i) => i.width));
      canvas.height = Math.max(...layers.map((i) => i.height));
      const context = canvas.getContext('2d');
      context.imageSmoothingEnabled = false;
      for (const layer of layers)
        context.drawImage(layer, 0, 0, canvas.width, canvas.height);
      return {
        image: canvas.toDataURL(),
        width: canvas.width,
        height: canvas.height,
        kind: 'item',
      };
    }
    const renderedImage = `data:image/png;base64,${await render(job)}`;
    const outSize = renderer.domElement.width || SIZE;
    const pixels = new Uint8Array(outSize * outSize * 4);
    const gl = renderer.getContext();
    gl.readPixels(0, 0, outSize, outSize, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    if (!pixels.some((value, index) => index % 4 === 3 && value > 0))
      throw new Error('Model has no visible pixels');
    return {
      image: renderedImage,
      width: outSize,
      height: outSize,
      kind: 'model',
    };
  } finally {
    if (renderer.domElement.width !== SIZE) renderer.setSize(SIZE, SIZE, false);
    for (const material of Object.values(factory.cachedMaterial)) {
      material.map?.dispose();
      material.dispose();
    }
    factory.cachedMaterial = {};
    for (const key of Object.keys(registry)) delete registry[key];
    images.clear();
  }
}
if (batchMode) {
  const jobs = await fetch('/.local/stat-render-jobs.json').then((r) =>
    r.json(),
  );
  window.renderProgress = { total: jobs.length, completed: 0, failures: [] };
  for (const job of jobs) {
    let result;
    try {
      result = { hash: job.hash, png: await render(job) };
    } catch (error) {
      result = { hash: job.hash, error: String(error) };
      window.renderProgress.failures.push(result);
    }
    const response = await fetch('/__stat_render_result', {
      method: 'POST',
      body: JSON.stringify(result),
    });
    if (!response.ok) throw new Error(await response.text());
    window.renderProgress.completed++;
    document.querySelector(
      '#status',
    ).textContent = `${window.renderProgress.completed} / ${jobs.length}`;
    if (window.renderProgress.completed % 100 === 0) {
      for (const material of Object.values(factory.cachedMaterial)) {
        material.map?.dispose();
        material.dispose();
      }
      factory.cachedMaterial = {};
      images.clear();
    }
  }
  await fetch('/__stat_render_result', {
    method: 'POST',
    body: JSON.stringify({ done: true }),
  });
  window.renderProgress.done = true;
}
