import fs from 'node:fs';
const p = 'scripts/java-entity-runtime.mjs';
let s = fs.readFileSync(p, 'utf8');
const old = `      else if (name === 'addBox' || name === 'addBoxVoxel') {
        const values = typeof args[0] === 'string' ? args.slice(1) : args;
        if (values.length < 6 || values.slice(0, 6).some((n) => !Number.isFinite(n)))
          throw new Error('Invalid model cube');
        receiver.cubes.push({
          origin: values.slice(0, 3),
          size: values.slice(3, 6),
          uv: [...receiver.uv],
          inflate: values[6] ?? 0,
          mirror: Boolean(values[7] ?? receiver.fields.mirror),
        });
      }`;
const neu = `      else if (name === 'addBox' || name === 'addBoxVoxel') {
        if (!receiver) throw new Error('Invalid model cube receiver');
        if (!Array.isArray(receiver.cubes)) receiver.cubes = [];
        if (!Array.isArray(receiver.uv)) receiver.uv = [0, 0];
        const values = typeof args[0] === 'string' ? args.slice(1) : args;
        if (values.length < 6 || values.slice(0, 6).some((n) => !Number.isFinite(n)))
          throw new Error('Invalid model cube');
        receiver.cubes.push({
          origin: values.slice(0, 3),
          size: values.slice(3, 6),
          uv: [...receiver.uv],
          inflate: values[6] ?? 0,
          mirror: Boolean(values[7] ?? receiver.fields?.mirror),
        });
      } else if (
        name === 'createMesh' &&
        (ownerFull.endsWith('HumanoidModel') || ownerFull.endsWith('AgeableListModel'))
      ) {
        const make = (boneName, pivot, cube) => {
          const bone = newBone('ModelPart');
          bone.name = boneName;
          bone.pivot = pivot;
          bone.cubes = [cube];
          bones.push(bone);
          return bone;
        };
        make('head', [0, 24, 0], {
          origin: [-4, 24, -4],
          size: [8, 8, 8],
          uv: [0, 0],
          inflate: 0,
          mirror: false,
        });
        make('body', [0, 24, 0], {
          origin: [-4, 12, -2],
          size: [8, 12, 4],
          uv: [16, 16],
          inflate: 0,
          mirror: false,
        });
        make('right_arm', [-5, 22, 0], {
          origin: [-8, 12, -2],
          size: [4, 12, 4],
          uv: [40, 16],
          inflate: 0,
          mirror: false,
        });
        make('left_arm', [5, 22, 0], {
          origin: [4, 12, -2],
          size: [4, 12, 4],
          uv: [32, 48],
          inflate: 0,
          mirror: false,
        });
        make('right_leg', [-1.9, 12, 0], {
          origin: [-3.9, 0, -2],
          size: [4, 12, 4],
          uv: [0, 16],
          inflate: 0,
          mirror: false,
        });
        make('left_leg', [1.9, 12, 0], {
          origin: [-0.1, 0, -2],
          size: [4, 12, 4],
          uv: [16, 48],
          inflate: 0,
          mirror: false,
        });
        returned = { type: 'MeshDefinition', fields: {} };
        self.fields.texWidth = self.fields.texWidth ?? 64;
        self.fields.texHeight = self.fields.texHeight ?? 64;
      }`;
if (!s.includes(old)) throw new Error('addBox block not found');
s = s.replace(old, neu);
fs.writeFileSync(p, s);
console.log('patched addBox + humanoid createMesh');
