import fs from 'node:fs';
const p = 'scripts/java-entity-runtime.mjs';
let s = fs.readFileSync(p, 'utf8');
s = s.replace(
  "      } else if (\n        name === '<init>' &&\n        /\\/(?:AdvancedModelBox|AdvancedModelRenderer|AnimatedModelRenderer|ModelPart)$/.test(\n          receiver?.type ?? '',\n        )\n      ) {",
  `      } else if (name === '<init>') {
        if (process.env.MC_JAVA_DEBUG)
          console.error('INIT', ownerFull, 'recvType', receiver?.type, 'args', args);
        if (
          /\\/(?:AdvancedModelBox|AdvancedModelRenderer|AnimatedModelRenderer|ModelPart)$/.test(
            receiver?.type ?? '',
          )
        ) {`,
);
// close the if properly - the original block ends with bones.push(receiver);
s = s.replace(
  `        if (typeof args[1] === 'string') receiver.name = args[1];
        if (typeof args[1] === 'number' && typeof args[2] === 'number')
          receiver.uv = args.slice(1, 3);
        bones.push(receiver);
      } else if (name === 'setPos'`,
  `        if (typeof args[1] === 'string') receiver.name = args[1];
        if (typeof args[1] === 'number' && typeof args[2] === 'number')
          receiver.uv = args.slice(1, 3);
        if (receiver?.cubes) bones.push(receiver);
        }
      } else if (name === 'setPos'`,
);
fs.writeFileSync(p, s);
console.log('init debug');
