import fs from 'node:fs';
const p = 'scripts/java-entity-runtime.mjs';
let s = fs.readFileSync(p, 'utf8');
const marker = `      }
      const returns = call[2].slice(call[2].indexOf(')') + 1);`;
const extra = `      } else if (name === 'create' && ownerFull.endsWith('CubeListBuilder')) {
        returned = newBone('CubeListBuilder');
      } else if (name === 'texOffs' && receiver?.cubes) {
        receiver.uv = args.slice(0, 2);
        returned = receiver;
      } else if (name === 'addOrReplaceChild') {
        const bone = newBone('PartDefinition');
        bone.name = args[0];
        const builder = args[1];
        const pose = args[2];
        bone.uv = builder?.uv ? [...builder.uv] : [0, 0];
        bone.cubes = (builder?.cubes ?? []).map((c) => ({
          ...c,
          uv: [...(c.uv ?? [0, 0])],
        }));
        if (pose?.pivot) bone.pivot = pose.pivot;
        if (pose?.rotation) bone.rotation = pose.rotation;
        bones.push(bone);
        returned = bone;
      } else if (name === 'getRoot' && ownerFull.endsWith('MeshDefinition')) {
        returned = newBone('PartDefinition');
      } else if (name === 'offset' && ownerFull.endsWith('PartPose')) {
        returned = { type: 'PartPose', pivot: args.slice(0, 3), rotation: [0, 0, 0] };
      } else if (
        (name === 'offsetAndRotation' || name === 'offsetAndRotationDegrees') &&
        ownerFull.endsWith('PartPose')
      ) {
        returned = {
          type: 'PartPose',
          pivot: args.slice(0, 3),
          rotation: args.slice(3, 6),
        };
      } else if (name === 'setTextureSize' || name === 'texSize') {
        self.fields.texWidth = args[0];
        self.fields.texHeight = args[1];
      }
      const returns = call[2].slice(call[2].indexOf(')') + 1);`;
const idx = s.indexOf(marker);
if (idx < 0) throw new Error('returns marker not found');
s = s.slice(0, idx) + extra + s.slice(idx + marker.length);
s = s.replace(
  /else if \(\/\^\[BCDFIJSZ\]\$\/\.test\(returns\)\)\s+throw new Error\(`Unsupported numeric entity call: \$\{ownerFull\}\.\$\{name\}`\);/,
  'else if (/^[BCDFIJSZ]$/.test(returns)) returned = 0;',
);
fs.writeFileSync(p, s);
console.log('patched invoke extras');
