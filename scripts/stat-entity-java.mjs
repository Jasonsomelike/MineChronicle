import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const argumentTypes = (descriptor) =>
  descriptor
    .slice(1, descriptor.indexOf(')'))
    .match(/\[*(?:[BCDFIJSZ]|L[^;]+;)/g) ?? [];

// Interpret only construction operations used by Citadel's generated models.
// Unknown control flow fails explicitly instead of publishing partial geometry.
export function parseJavaModel(
  disassembly,
  className,
  resolveClass,
  depth = 0,
) {
  if (depth > 8) throw new Error('Entity model inheritance exceeded limit');
  const lines = disassembly.split(/\r?\n/);
  let start = lines.findIndex(
    (line) => line.trim() === `public ${className}();`,
  );
  if (start < 0)
    start = lines.findIndex(
      (line) =>
        line.trim().startsWith(`public ${className}(`) &&
        /^((boolean|int|float|double)(, )?)*$/.test(
          line.slice(line.indexOf('(') + 1, line.indexOf(')')),
        ),
    );
  if (start < 0)
    throw new Error(`No supported model constructor: ${className}`);
  const signature = lines[start];
  const defaults = signature
    .slice(signature.indexOf('(') + 1, signature.indexOf(')'))
    .split(',')
    .filter(Boolean)
    .map(() => 0);
  const self = { type: className, fields: {} };
  const locals = [self, ...defaults],
    stack = [],
    bones = [];
  let complete = false;
  const pop = () => {
    if (!stack.length) throw new Error('Invalid construction stack');
    return stack.pop();
  };
  const nextMethod = lines.findIndex(
    (line, i) =>
      i > start && /^ {2}(public|private|protected|static) /.test(line),
  );
  const instructions = [];
  const code = lines.slice(start + 1, nextMethod < 0 ? undefined : nextMethod);
  for (let i = 0; i < code.length; i++) {
    const instruction = code[i].match(
      /^\s*(\d+):\s+(\w+)(?:\s+([^/]*?))?(?:\s*\/\/\s*(.*))?$/,
    );
    if (!instruction) continue;
    if (instruction[2] === 'tableswitch' || instruction[2] === 'lookupswitch') {
      instruction.switchTargets = {};
      while (++i < code.length && !code[i].includes('}')) {
        const target = code[i].match(/^\s*(default|-?\d+):\s*(\d+)$/);
        if (!target) throw new Error('Invalid constructor switch table');
        instruction.switchTargets[target[1]] = Number(target[2]);
      }
    }
    instructions.push(instruction);
  }
  const offsets = new Map(
    instructions.map((instruction, i) => [Number(instruction[1]), i]),
  );
  let steps = 0;
  for (let ip = 0; ip < instructions.length; ip++) {
    if (++steps > 50000)
      throw new Error('Entity constructor exceeded instruction limit');
    const [, , op, operand = '', note = ''] = instructions[ip];
    if (op === 'return') {
      complete = true;
      break;
    }
    if (op === 'tableswitch' || op === 'lookupswitch') {
      const value = pop();
      if (!Number.isInteger(value))
        throw new Error('Unknown entity constructor switch');
      const table = instructions[ip].switchTargets;
      const target = offsets.get(table[value] ?? table.default);
      if (target === undefined)
        throw new Error('Invalid entity constructor switch jump');
      ip = target - 1;
    } else if (op === 'goto' || /^if(?:_icmp)?(eq|ne|lt|ge|gt|le)$/.test(op)) {
      let jump = op === 'goto';
      if (!jump) {
        const b = op.startsWith('if_icmp') ? pop() : 0;
        const a = pop();
        if (!Number.isFinite(a) || !Number.isFinite(b))
          throw new Error('Unknown entity constructor branch');
        jump = op.endsWith('eq')
          ? a === b
          : op.endsWith('ne')
          ? a !== b
          : op.endsWith('lt')
          ? a < b
          : op.endsWith('ge')
          ? a >= b
          : op.endsWith('gt')
          ? a > b
          : a <= b;
      }
      if (jump) {
        const target = offsets.get(Number(operand.trim()));
        if (target === undefined)
          throw new Error('Invalid entity constructor jump');
        ip = target - 1;
      }
    } else if (/^[aifdl]load(?:_\d+)?$/.test(op)) {
      const slot = Number(op.includes('_') ? op.split('_')[1] : operand.trim());
      stack.push(locals[slot]);
    } else if (/^[aifdl]store(?:_\d+)?$/.test(op)) {
      const slot = Number(op.includes('_') ? op.split('_')[1] : operand.trim());
      locals[slot] = pop();
    } else if (/^[ifdl]const_/.test(op)) {
      stack.push(op.endsWith('m1') ? -1 : Number(op.split('_')[1]));
    } else if (op === 'bipush' || op === 'sipush')
      stack.push(Number(operand.trim()));
    else if (op === 'aconst_null') stack.push(null);
    else if (op === 'ldc' || op === 'ldc_w' || op === 'ldc2_w') {
      if (/^(float|double|int|long) /.test(note))
        stack.push(Number(note.replace(/^\w+ /, '').replace(/[fdl]$/, '')));
      else if (note.startsWith('String ')) stack.push(note.slice(7));
      else throw new Error(`Unsupported model constant: ${note}`);
    } else if (op === 'new')
      stack.push({
        type: note.replace(/^class /, ''),
        fields: {},
        cubes: [],
        pivot: [0, 0, 0],
        rotation: [0, 0, 0],
        uv: [0, 0],
      });
    else if (op === 'anewarray' || op === 'newarray') {
      const length = pop();
      if (!Number.isInteger(length) || length < 0 || length > 10000)
        throw new Error('Invalid model array length');
      stack.push(Array(length).fill(op === 'anewarray' ? null : 0));
    } else if (/^[aifdlbcs]aload$/.test(op)) {
      const index = pop(),
        array = pop();
      if (
        !Array.isArray(array) ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= array.length
      )
        throw new Error('Invalid model array read');
      stack.push(array[index]);
    } else if (/^[aifdlbcs]astore$/.test(op)) {
      const value = pop(),
        index = pop(),
        array = pop();
      if (
        !Array.isArray(array) ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= array.length
      )
        throw new Error('Invalid model array write');
      array[index] = value;
    } else if (op === 'arraylength') {
      const array = pop();
      if (!Array.isArray(array)) throw new Error('Unknown model array');
      stack.push(array.length);
    } else if (op === 'dup') stack.push(stack[stack.length - 1]);
    else if (op === 'pop') pop();
    else if (op === 'getstatic' && /:L[^;]+;$/.test(note))
      stack.push({ type: note, fields: {} });
    else if (op === 'getfield' || op === 'putfield') {
      const field = note
        .replace(/^Field /, '')
        .split(':')[0]
        .split('.')
        .pop();
      if (op === 'getfield') stack.push(pop().fields[field]);
      else {
        const value = pop(),
          receiver = pop();
        receiver.fields[field] = value;
        if (receiver === self && value?.cubes && !value.name)
          value.name = field;
      }
    } else if (/^[ifdl](add|sub|mul|div)$/.test(op)) {
      const b = pop(),
        a = pop();
      stack.push(
        op.endsWith('add')
          ? a + b
          : op.endsWith('sub')
          ? a - b
          : op.endsWith('mul')
          ? a * b
          : a / b,
      );
    } else if (/^[fd]cmp[gl]$/.test(op)) {
      const b = pop(),
        a = pop();
      if (typeof a !== 'number' || typeof b !== 'number')
        throw new Error('Unknown constructor comparison');
      stack.push(
        Number.isNaN(a) || Number.isNaN(b)
          ? op.endsWith('g')
            ? 1
            : -1
          : a > b
          ? 1
          : a < b
          ? -1
          : 0,
      );
    } else if (/^[ifdl]neg$/.test(op)) stack.push(-pop());
    else if (/^[ifdl]2[ifdl]$/.test(op) || op === 'checkcast') continue;
    else if (op.startsWith('invoke')) {
      const call = note.match(/(?:InterfaceMethod|Method) (.+):(\(.*\).+)$/);
      if (!call) throw new Error(`Unsupported model call: ${note}`);
      const name = call[1].split('.').pop().replaceAll('"', '');
      const owner = call[1].includes('.')
        ? call[1].slice(0, call[1].lastIndexOf('.')).replaceAll('/', '.')
        : className;
      const types = argumentTypes(call[2]);
      const args = Array.from({ length: types.length }, pop).reverse();
      const receiver = op === 'invokestatic' ? null : pop();
      let returned;
      if (
        name === '<init>' &&
        receiver === self &&
        owner !== className &&
        !/(?:^|\.)(?:Object|AdvancedEntityModel|EntityModel)$/.test(owner)
      ) {
        if (!resolveClass)
          throw new Error(`Missing inherited entity geometry: ${owner}`);
        const parent = parseJavaModel(
          resolveClass(owner),
          owner,
          resolveClass,
          depth + 1,
        );
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
      } else if (
        (owner === 'com.github.alexthe666.alexsmobs.entity.util.Maths' &&
          name === 'rad') ||
        (owner === 'java.lang.Math' && name === 'toRadians')
      ) {
        if (args.length !== 1 || !Number.isFinite(args[0]))
          throw new Error('Invalid entity angle conversion');
        returned = (args[0] * Math.PI) / 180;
        if (name === 'rad') returned = Math.fround(returned);
      } else if (
        name === '<init>' &&
        /\/(?:AdvancedModelBox|AdvancedModelRenderer|AnimatedModelRenderer)$/.test(
          receiver?.type ?? '',
        )
      ) {
        if (typeof args[1] === 'string') receiver.name = args[1];
        if (typeof args[1] === 'number' && typeof args[2] === 'number')
          receiver.uv = args.slice(1, 3);
        bones.push(receiver);
      } else if (name === 'setPos' || name === 'setRotationPoint')
        receiver.pivot = args.slice(0, 3);
      else if (name === 'addChild') args[0].parent = receiver;
      else if (name === 'setTextureOffset') receiver.uv = args.slice(0, 2);
      else if (name === 'setRotationAngle' || name === 'setRotateAngle')
        args[0].rotation = args.slice(1, 4);
      else if (name === 'addBox') {
        const values = typeof args[0] === 'string' ? args.slice(1) : args;
        if (
          values.length < 6 ||
          values.slice(0, 6).some((n) => !Number.isFinite(n))
        )
          throw new Error('Invalid model cube');
        receiver.cubes.push({
          origin: values.slice(0, 3),
          size: values.slice(3, 6),
          uv: [...receiver.uv],
          inflate: values[6] ?? 0,
          mirror: Boolean(values[7] ?? receiver.fields.mirror),
        });
      }
      const returns = call[2].slice(call[2].indexOf(')') + 1);
      if (returns !== 'V') {
        if (returned !== undefined) stack.push(returned);
        else if (/^[BCDFIJSZ]$/.test(returns))
          throw new Error(`Unsupported numeric entity call: ${owner}.${name}`);
        else stack.push(receiver ?? { type: returns, fields: {} });
      }
    } else throw new Error(`Unsupported model instruction ${op}`);
  }
  if (!complete || !bones.some((bone) => bone.cubes.length))
    throw new Error('No complete entity geometry');
  const fieldName = (bone) =>
    Object.entries(self.fields).find(([, value]) => value === bone)?.[0];
  const boneName = (bone) => fieldName(bone) ?? `bone${bones.indexOf(bone)}`;
  const model = {
    format: 'java',
    textureWidth: self.fields.texWidth ?? self.fields.textureWidth ?? 64,
    textureHeight: self.fields.texHeight ?? self.fields.textureHeight ?? 32,
    bones: bones.map((bone) => ({
      name: boneName(bone),
      field: fieldName(bone),
      ...(bone.parent ? { parent: boneName(bone.parent) } : {}),
      pivot: bone.pivot,
      rotation: ['rotateAngleX', 'rotateAngleY', 'rotateAngleZ'].map(
        (field, axis) => bone.fields[field] ?? bone.rotation[axis],
      ),
      cubes: bone.cubes,
      ...(bone.fields.showModel === 0 ? { hidden: true } : {}),
    })),
  };
  const finite = (values, label) => {
    if (values.some((value) => !Number.isFinite(value)))
      throw new Error(`Invalid numeric entity geometry: ${label}`);
  };
  finite([model.textureWidth, model.textureHeight], 'texture size');
  for (const bone of model.bones) {
    finite(bone.pivot, `${bone.name} pivot`);
    finite(bone.rotation, `${bone.name} rotation`);
    for (const cube of bone.cubes) {
      finite(
        [...cube.origin, ...cube.size, ...cube.uv, cube.inflate],
        `${bone.name} cube`,
      );
    }
  }
  return model;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [input, className, output, archive] = process.argv.slice(2);
  try {
    fs.writeFileSync(
      output,
      JSON.stringify(
        parseJavaModel(
          fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, ''),
          className,
          archive
            ? (name) =>
                execFileSync(
                  'javap',
                  ['-classpath', archive, '-c', '-p', name],
                  {
                    encoding: 'utf8',
                    maxBuffer: 16 * 1024 * 1024,
                    windowsHide: true,
                  },
                )
            : undefined,
        ),
      ),
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
