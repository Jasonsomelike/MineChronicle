import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const zeroPose = () => ({ pivot: [0, 0, 0], rotation: [0, 0, 0] });
const part = (name = 'root') => ({
  name,
  children: new Map(),
  ...zeroPose(),
  cubes: [],
});
const mesh = () => ({ root: part() });
function humanoidMesh(deformation = { inflate: [0, 0, 0] }, offset = 0) {
  // Mojang HumanoidModel.createMesh: retained when a mod extends the vanilla
  // biped layer and replaces only selected parts.
  const value = mesh();
  const add = (name, pivot, origin, size, uv, mirror = false, growth = 0) =>
    value.root.children.set(name, {
      ...part(name),
      pivot,
      cubes: [
        { origin, size, uv, mirror, inflate: deformation.inflate[0] + growth },
      ],
    });
  add('head', [0, offset, 0], [-4, -8, -4], [8, 8, 8], [0, 0]);
  add('hat', [0, offset, 0], [-4, -8, -4], [8, 8, 8], [32, 0], false, 0.5);
  add('body', [0, offset, 0], [-4, 0, -2], [8, 12, 4], [16, 16]);
  add('right_arm', [-5, 2 + offset, 0], [-3, -2, -2], [4, 12, 4], [40, 16]);
  add('left_arm', [5, 2 + offset, 0], [-1, -2, -2], [4, 12, 4], [40, 16], true);
  add('right_leg', [-1.9, 12 + offset, 0], [-2, 0, -2], [4, 12, 4], [0, 16]);
  add(
    'left_leg',
    [1.9, 12 + offset, 0],
    [-2, 0, -2],
    [4, 12, 4],
    [0, 16],
    true,
  );
  return value;
}
function quadrupedMesh(height, deformation) {
  // QuadrupedModel.createBodyMesh, Mojang source mirrored at
  // github.com/mahtomedi/minecraft/blob/main/src/main/java/net/minecraft/client/model/QuadrupedModel.java
  const value = mesh();
  const add = (name, pivot, rotation, origin, size, uv) =>
    value.root.children.set(name, {
      ...part(name),
      pivot,
      rotation,
      cubes: [{ origin, size, uv, inflate: deformation.inflate[0] }],
    });
  add('head', [0, 18 - height, -6], [0, 0, 0], [-4, -4, -8], [8, 8, 8], [0, 0]);
  add(
    'body',
    [0, 17 - height, 2],
    [Math.PI / 2, 0, 0],
    [-5, -10, -7],
    [10, 16, 8],
    [28, 8],
  );
  for (const [name, x, z] of [
    ['right_hind_leg', -3, 7],
    ['left_hind_leg', 3, 7],
    ['right_front_leg', -3, -5],
    ['left_front_leg', 3, -5],
  ]) {
    add(
      name,
      [x, 24 - height, z],
      [0, 0, 0],
      [-2, 0, -2],
      [4, height, 4],
      [0, 16],
    );
  }
  return value;
}
const signature = (descriptor) => {
  const end = descriptor.indexOf(')');
  return {
    args: descriptor.slice(1, end).match(/\[*L[^;]+;|\[*[ZBCSIJFD]/g) ?? [],
    result: descriptor.slice(end + 1),
  };
};
function methods(text) {
  const found = new Map();
  found.superclass = text.match(
    /^\s+super_class:\s+#\d+\s+\/\/ ([\w/]+)/m,
  )?.[1];
  if (!found.superclass) {
    let header = text.match(/^public (?:abstract )?class [^\n]+/m)?.[0] ?? '';
    while (/<[^<>]*>/.test(header)) header = header.replace(/<[^<>]*>/g, '');
    found.superclass = header
      .match(/ extends ([\w.]+)/)?.[1]
      ?.replaceAll('.', '/');
  }
  found.recipes = new Map();
  for (const match of text.matchAll(
    /^\s+(\d+): #[^\n]+StringConcatFactory[^\n]*\r?\n\s+Method arguments:\r?\n\s+#\d+ (.*)$/gm,
  )) {
    found.recipes.set(Number(match[1]), match[2].replace(/\\u0001/g, '\u0001'));
  }
  let method;
  for (const line of text.split(/\r?\n/)) {
    const header = line.match(
      /^ {2}(?:public |private |protected )?(?:static )?.*?([\w$]+)\([^)]*\)(?: throws [^;]+)?;/,
    );
    if (header) {
      const parameters = line
        .slice(line.indexOf('(') + 1, line.indexOf(')'))
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      const descriptor = parameters
        .map((value) => {
          let prefix = '';
          while (value.endsWith('[]')) {
            prefix += '[';
            value = value.slice(0, -2);
          }
          return (
            prefix +
            ({
              boolean: 'Z',
              byte: 'B',
              char: 'C',
              short: 'S',
              int: 'I',
              long: 'J',
              float: 'F',
              double: 'D',
            }[value] ?? `L${value.replaceAll('.', '/')};`)
          );
        })
        .join('');
      method = { name: header[1], parameters, instructions: [] };
      found.set(header[1], method);
      found.set(`${header[1]}(${descriptor})`, method);
      continue;
    }
    if (!method) continue;
    const instruction = line.match(/^\s+(\d+):\s+(\w+)(?:\s+(.*?))?\s*$/);
    if (instruction) {
      const [operand, comment = ''] = (instruction[3] ?? '').split(
        /\s+\/\/\s*/,
        2,
      );
      method.instructions.push({
        address: Number(instruction[1]),
        op: instruction[2],
        operand,
        comment,
      });
    }
  }
  return found;
}

// Interpret only the model-building APIs. Unknown bytecode/methods fail instead
// of publishing a model with silently omitted parts.
export function parseLayerModel(text, className, options = {}) {
  const classes = new Map([[className.replaceAll('.', '/'), methods(text)]]);
  function execute(owner, name, args = [], depth = 0, descriptor) {
    if (depth > 12) throw new Error('Model method recursion limit');
    if (!classes.has(owner)) {
      const source = options.resolveClass?.(owner);
      if (!source) throw new Error(`Missing model class ${owner}`);
      classes.set(owner, methods(source));
    }
    const method = classes
      .get(owner)
      .get(
        descriptor
          ? `${name}${descriptor.slice(0, descriptor.indexOf(')') + 1)}`
          : name,
      );
    if (!method) {
      const superclass = classes.get(owner).superclass;
      if (superclass)
        return execute(superclass, name, args, depth + 1, descriptor);
      throw new Error(`Missing model method ${owner}.${name}`);
    }
    const code = method.instructions;
    const locations = new Map(
      code.map((instruction, index) => [instruction.address, index]),
    );
    const stack = [],
      locals = [];
    for (const [index, value] of args.entries()) {
      locals.push(value);
      if (['double', 'long'].includes(method.parameters[index]))
        locals.push(undefined);
    }
    let operations = 0;
    for (let index = 0; index < code.length; index++) {
      if (++operations > 50000)
        throw new Error('Model bytecode operation limit');
      const { op, operand, comment } = code[index];
      const constant = op.match(/^[ifd]const_(m1|\d)$/);
      const load = op.match(/^[aifd]load(?:_(\d))?$/);
      const store = op.match(/^[aifd]store(?:_(\d))?$/);
      if (constant) stack.push(constant[1] === 'm1' ? -1 : Number(constant[1]));
      else if (load) stack.push(locals[Number(load[1] ?? operand)]);
      else if (store) locals[Number(store[1] ?? operand)] = stack.pop();
      else if (op === 'aconst_null') stack.push(null);
      else if (op === 'bipush' || op === 'sipush') stack.push(Number(operand));
      else if (op === 'ldc' || op === 'ldc_w' || op === 'ldc2_w') {
        if (comment.startsWith('String ')) stack.push(comment.slice(7));
        else if (/^(float|double|int|long) /.test(comment))
          stack.push(
            Number(comment.replace(/^\w+ /, '').replace(/[fdl]$/, '')),
          );
        else throw new Error(`Unknown constant: ${comment}`);
      } else if (op === 'new')
        stack.push({ type: comment.replace(/^class /, '') });
      else if (op === 'dup') stack.push(stack.at(-1));
      else if (op === 'pop') stack.pop();
      else if (op === 'checkcast') continue;
      else if (op === 'getstatic') {
        if (comment.includes('/PartPose.')) stack.push(zeroPose());
        else if (comment.includes('/CubeDeformation.'))
          stack.push({ inflate: [0, 0, 0] });
        else throw new Error(`Unknown static model field: ${comment}`);
      } else if (/^[ifd](add|sub|mul|div|rem)$/.test(op)) {
        const b = stack.pop(),
          a = stack.pop();
        const value = {
          add: () => a + b,
          sub: () => a - b,
          mul: () => a * b,
          div: () => a / b,
          rem: () => a % b,
        }[op.slice(1)]();
        stack.push(op[0] === 'i' ? Math.trunc(value) : value);
      } else if (/^[ifd]neg$/.test(op)) stack.push(-stack.pop());
      else if (/^[ifd]2[ifd]$/.test(op)) {
        if (op.at(-1) === 'i') stack.push(Math.trunc(stack.pop()));
      } else if (op === 'iinc') {
        const [slot, amount] = operand.split(',').map(Number);
        locals[slot] += amount;
      } else if (/^if(_[ai]cmp)?(eq|ne|lt|le|gt|ge)$/.test(op)) {
        const comparison = op.match(/(eq|ne|lt|le|gt|ge)$/)[1];
        const b = op.includes('cmp') ? stack.pop() : 0,
          a = stack.pop();
        if (
          {
            eq: a === b,
            ne: a !== b,
            lt: a < b,
            le: a <= b,
            gt: a > b,
            ge: a >= b,
          }[comparison]
        )
          index = locations.get(Number(operand)) - 1;
      } else if (op === 'goto') index = locations.get(Number(operand)) - 1;
      else if (op === 'invokedynamic') {
        const concat = comment.match(
          /^InvokeDynamic #(\d+):makeConcatWithConstants:(.*)$/,
        );
        const recipe =
          concat && classes.get(owner).recipes.get(Number(concat[1]));
        if (recipe === undefined)
          throw new Error(`Unsupported model dynamic call: ${comment}`);
        const types = signature(concat[2]);
        const values = stack.splice(
          stack.length - types.args.length,
          types.args.length,
        );
        let slot = 0;
        stack.push(recipe.replaceAll('\u0001', () => String(values[slot++])));
      } else if (
        op === 'areturn' ||
        op === 'freturn' ||
        op === 'ireturn' ||
        op === 'dreturn'
      )
        return stack.pop();
      else if (op === 'return') return;
      else if (/^invoke(static|virtual|special|interface)$/.test(op)) {
        const reference = comment.replace(/^(?:InterfaceMethod|Method) /, '');
        const colon = reference.indexOf(':');
        const target = reference.slice(0, colon),
          descriptor = reference.slice(colon + 1);
        const dot = target.lastIndexOf('.');
        const targetOwner = dot < 0 ? owner : target.slice(0, dot);
        const targetName = (
          dot < 0 ? target : target.slice(dot + 1)
        ).replaceAll('"', '');
        const types = signature(descriptor);
        const values = stack.splice(
          stack.length - types.args.length,
          types.args.length,
        );
        const receiver = op === 'invokestatic' ? null : stack.pop();
        let result;
        if (targetName === '<init>') {
          if (targetOwner.endsWith('/MeshDefinition'))
            Object.assign(receiver, mesh());
          else if (targetOwner.endsWith('/CubeDeformation'))
            receiver.inflate =
              values.length === 1 ? Array(3).fill(values[0]) : values;
          else if (targetOwner.endsWith('/CubeListBuilder') && !values.length)
            Object.assign(receiver, { cubes: [], uv: [0, 0], mirror: false });
          else throw new Error(`Unknown model constructor: ${targetOwner}`);
        } else if (
          targetOwner.endsWith('/MeshDefinition') &&
          types.result.endsWith('/PartDefinition;')
        )
          result = receiver.root;
        else if (targetOwner.endsWith('/CubeListBuilder')) {
          if (!receiver) result = { cubes: [], uv: [0, 0], mirror: false };
          else if (types.args.join('') === 'II') {
            receiver.uv = values;
            result = receiver;
          } else if (
            types.args.length <= 1 &&
            (!types.args.length || types.args[0] === 'Z')
          ) {
            receiver.mirror = values.length ? !!values[0] : true;
            result = receiver;
          } else {
            const numeric = values.filter(
              (value, at) =>
                types.args[at] !== 'Ljava/lang/String;' &&
                types.args[at] !== 'Z' &&
                typeof value === 'number',
            );
            const deformation = values.find((value) => value?.inflate);
            if (
              ![6, 8].includes(numeric.length) ||
              types.args.some(
                (type) =>
                  !['I', 'F', 'Z', 'Ljava/lang/String;'].includes(type) &&
                  !type.endsWith('/CubeDeformation;'),
              )
            )
              throw new Error(`Unknown cube arguments: ${descriptor}`);
            let uvScale = [1, 1];
            if (numeric.length === 8) {
              if (
                types.args[0] === 'Ljava/lang/String;' &&
                types.args.slice(-2).join('') === 'II'
              )
                receiver.uv = numeric.slice(6);
              else if (deformation && types.args.slice(-2).join('') === 'FF')
                uvScale = numeric.slice(6);
              else throw new Error(`Unknown cube UV arguments: ${descriptor}`);
            }
            if (uvScale.some((value) => !Number.isFinite(value) || value <= 0))
              throw new Error('Invalid cube UV scale');
            const inflate = deformation?.inflate ?? [0, 0, 0];
            receiver.cubes.push({
              origin: numeric.slice(0, 3),
              size: numeric.slice(3, 6),
              uv: [...receiver.uv],
              ...(uvScale.some((value) => value !== 1) ? { uvScale } : {}),
              inflate: inflate.every((value) => value === inflate[0])
                ? inflate[0]
                : inflate,
              mirror: types.args.includes('Z')
                ? !!values[types.args.indexOf('Z')]
                : receiver.mirror,
            });
            result = receiver;
          }
        } else if (targetOwner.endsWith('/CubeDeformation')) {
          const growth =
            values.length === 1 ? Array(3).fill(values[0]) : values;
          result = {
            inflate: receiver.inflate.map((value, at) => value + growth[at]),
          };
        } else if (targetOwner.endsWith('/PartPose')) {
          if (values.length === 6)
            result = { pivot: values.slice(0, 3), rotation: values.slice(3) };
          else if (targetName === 'rotation' || targetName === 'm_171420_')
            result = { pivot: [0, 0, 0], rotation: values };
          else result = { pivot: values, rotation: [0, 0, 0] };
        } else if (targetOwner.endsWith('/PartDefinition')) {
          if (types.args.length === 3) {
            const [childName, builder, pose] = values;
            const previous = receiver.children.get(childName);
            result = {
              ...part(childName),
              ...pose,
              cubes: structuredClone(builder.cubes),
              children: previous?.children ?? new Map(),
            };
            receiver.children.set(childName, result);
          } else if (types.args.length === 1 && typeof values[0] === 'string') {
            result = receiver.children.get(values[0]);
            if (!result) throw new Error(`Unknown model child: ${values[0]}`);
          } else throw new Error(`Unknown part operation: ${descriptor}`);
        } else if (
          targetOwner.endsWith('/LayerDefinition') &&
          types.args.length === 3
        ) {
          result = {
            mesh: values[0],
            textureWidth: values[1],
            textureHeight: values[2],
          };
        } else if (
          targetOwner.endsWith('/HumanoidModel') &&
          types.result.endsWith('/MeshDefinition;')
        )
          result = humanoidMesh(...values);
        else if (
          targetOwner.endsWith('/QuadrupedModel') &&
          types.result.endsWith('/MeshDefinition;')
        )
          result = quadrupedMesh(...values);
        else if (
          (targetOwner === 'java/lang/Math' || targetOwner.endsWith('/Mth')) &&
          typeof Math[targetName] === 'function'
        )
          result = Math[targetName](...values);
        else {
          result = options.external?.(targetOwner, targetName, values);
          if (result === undefined)
            result = execute(
              targetOwner,
              targetName,
              values,
              depth + 1,
              descriptor,
            );
        }
        if (types.result !== 'V') stack.push(result);
      } else
        throw new Error(
          `Unsupported model bytecode ${owner}.${name}: ${op} ${operand} ${comment}`,
        );
    }
    throw new Error(`Model method has no return: ${owner}.${name}`);
  }
  const factories = [
    ...text.matchAll(/^ {2}public static [^\n]*LayerDefinition (\w+)\(\);/gm),
  ].map((m) => m[1]);
  const selectedMethod =
    options.method === 'auto'
      ? factories.includes('createBodyLayer')
        ? 'createBodyLayer'
        : factories.length === 1
        ? factories[0]
        : null
      : options.method ?? 'createBodyLayer';
  if (!selectedMethod)
    throw new Error('No unambiguous zero-argument layer factory');
  const layer = execute(
    className.replaceAll('.', '/'),
    selectedMethod,
    options.args ?? [],
  );
  const bones = [];
  function visit(node, parent) {
    const name = parent ? `${parent}/${node.name}` : node.name;
    bones.push({
      name,
      ...(parent ? { parent } : {}),
      pivot: node.pivot,
      rotation: node.rotation,
      cubes: node.cubes,
    });
    for (const child of node.children.values()) visit(child, name);
  }
  if (!layer?.mesh || !layer.textureWidth || !layer.textureHeight)
    throw new Error('Layer dimensions are missing');
  visit(layer.mesh.root);
  if (!bones.some((bone) => bone.cubes.length))
    throw new Error('Layer model has no cubes');
  return {
    format: 'java',
    textureWidth: layer.textureWidth,
    textureHeight: layer.textureHeight,
    bones,
  };
}

export function readLayerModel(jar, className, options = {}) {
  const cache = new Map();
  function readClass(name) {
    if (!cache.has(name))
      cache.set(
        name,
        execFileSync(
          options.javap ?? 'javap',
          [
            '-J-Duser.language=en',
            '-J-Duser.country=US',
            '-J-Dfile.encoding=UTF-8',
            '-classpath',
            jar,
            '-c',
            '-p',
            '-v',
            name.replaceAll('/', '.'),
          ],
          {
            encoding: 'utf8',
            windowsHide: true,
            maxBuffer: 8 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        ),
      );
    return cache.get(name);
  }
  return parseLayerModel(readClass(className), className, {
    ...options,
    resolveClass: readClass,
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [, , jar, className, method, argumentsJson] = process.argv;
  try {
    console.log(
      JSON.stringify(
        readLayerModel(jar, className, {
          ...(method ? { method } : {}),
          ...(argumentsJson ? { args: JSON.parse(argumentsJson) } : {}),
        }),
      ),
    );
  } catch (error) {
    const message = String(error.stderr || error.message || error)
      .trim()
      .split(/\r?\n/)
      .slice(0, 2)
      .join(' ');
    console.error(`Layer model ${className}: ${message}`);
    process.exitCode = 1;
  }
}
