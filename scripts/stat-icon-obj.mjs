import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

export async function renderObj(job, renderer) {
  const textures = await Promise.all(
    job.layers.map(async (file) => {
      const texture = await new THREE.TextureLoader().loadAsync(
        `/.local/stat-frames/${file}`,
      );
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      if (job.objWrap === 'repeat') {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
      }
      texture.encoding = THREE.sRGBEncoding;
      return texture;
    }),
  );
  const object = new OBJLoader().parse(job.obj);
  if (job.objGroups) {
    for (const child of [...object.children]) {
      if (job.objGroups.includes(child.name)) continue;
      child.traverse((part) => {
        if (part.isMesh) {
          part.geometry.dispose();
          for (const material of Array.isArray(part.material)
            ? part.material
            : [part.material])
            material.dispose();
        }
      });
      object.remove(child);
    }
  }
  const materials = [];
  try {
    object.traverse((child) => {
      if (!child.isMesh) return;
      const settings = job.objMaterials?.[child.name] ??
        job.objMaterials?.['*'] ?? { layer: 0 };
      if (!textures[settings.layer]) throw new Error('OBJ texture is missing');
      for (const old of Array.isArray(child.material)
        ? child.material
        : [child.material])
        old.dispose();
      child.material = new THREE.MeshLambertMaterial({
        map: textures[settings.layer],
        color: settings.tint ?? 0xffffff,
        side: THREE.DoubleSide,
        alphaTest: 1 / 255,
      });
      materials.push(child.material);
      child.geometry.computeVertexNormals();
    });
    object.rotation.set(
      ...(job.rotation ?? [30, 225, 0]).map(THREE.MathUtils.degToRad),
    );
    object.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(object);
    const center = bounds.getCenter(new THREE.Vector3());
    const extent = bounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(extent.length()) || extent.length() === 0)
      throw new Error('OBJ has no visible geometry');
    object.position.sub(center);
    const half = (Math.max(extent.x, extent.y) * 0.56) / (job.iconScale ?? 1);
    const camera = new THREE.OrthographicCamera(
      -half,
      half,
      half,
      -half,
      0.01,
      1000,
    );
    camera.position.set(0, 0, Math.max(extent.z * 2, 10));
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const light = new THREE.DirectionalLight(0xffffff, 0.65);
    light.position.set(-3, 7, 5);
    scene.add(light, object);
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png').split(',')[1];
  } finally {
    object.traverse((child) => {
      if (child.isMesh) child.geometry.dispose();
    });
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
  }
}
