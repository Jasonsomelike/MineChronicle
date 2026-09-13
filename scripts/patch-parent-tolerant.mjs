import fs from 'node:fs';
const p = 'scripts/java-entity-runtime.mjs';
let s = fs.readFileSync(p, 'utf8');
const old = `        const parent = parseJavaModelFromClass(parentBytes, resolveClass, depth + 1);
        const inherited = new Map(
          parent.bones.map((bone) => [bone.name, { ...bone, fields: {}, uv: [0, 0] }]),
        );
        for (const bone of parent.bones) {
          const raw = inherited.get(bone.name);
          raw.parent = bone.parent ? inherited.get(bone.parent) : undefined;
          self.fields[bone.field ?? bone.name] = raw;
          bones.push(raw);
        }
        self.fields.texWidth = parent.textureWidth;
        self.fields.texHeight = parent.textureHeight;`;
const neu = `        let parent = null;
        try {
          parent = parseJavaModelFromClass(parentBytes, resolveClass, depth + 1);
        } catch {
          parent = null;
        }
        if (parent) {
          const inherited = new Map(
            parent.bones.map((bone) => [
              bone.name,
              { ...bone, fields: {}, uv: [0, 0] },
            ]),
          );
          for (const bone of parent.bones) {
            const raw = inherited.get(bone.name);
            raw.parent = bone.parent ? inherited.get(bone.parent) : undefined;
            self.fields[bone.field ?? bone.name] = raw;
            bones.push(raw);
          }
          self.fields.texWidth = parent.textureWidth;
          self.fields.texHeight = parent.textureHeight;
        }`;
if (!s.includes(old)) throw new Error('parent block not found');
s = s.replace(old, neu);
fs.writeFileSync(p, s);
console.log('parent try/catch ok');
