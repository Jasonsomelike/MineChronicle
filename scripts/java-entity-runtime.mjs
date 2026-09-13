/**
 * Parse Minecraft entity model constructors from raw .class bytes.
 * Never executes game code. Compatible with the offline javap interpreter's
 * construction subset (texOffs / addBox / setPos / addChild / inheritance).
 */

const OP = {
  0x00: ['nop'],
  0x01: ['aconst_null'],
  0x02: ['iconst_m1'],
  0x03: ['iconst_0'],
  0x04: ['iconst_1'],
  0x05: ['iconst_2'],
  0x06: ['iconst_3'],
  0x07: ['iconst_4'],
  0x08: ['iconst_5'],
  0x09: ['lconst_0'],
  0x0a: ['lconst_1'],
  0x0b: ['fconst_0'],
  0x0c: ['fconst_1'],
  0x0d: ['fconst_2'],
  0x0e: ['dconst_0'],
  0x0f: ['dconst_1'],
  0x10: ['bipush', 'i8'],
  0x11: ['sipush', 'i16'],
  0x12: ['ldc', 'u8'],
  0x13: ['ldc_w', 'u16'],
  0x14: ['ldc2_w', 'u16'],
  0x15: ['iload', 'u8'],
  0x16: ['lload', 'u8'],
  0x17: ['fload', 'u8'],
  0x18: ['dload', 'u8'],
  0x19: ['aload', 'u8'],
  0x1a: ['iload_0'],
  0x1b: ['iload_1'],
  0x1c: ['iload_2'],
  0x1d: ['iload_3'],
  0x1e: ['lload_0'],
  0x1f: ['lload_1'],
  0x20: ['lload_2'],
  0x21: ['lload_3'],
  0x22: ['fload_0'],
  0x23: ['fload_1'],
  0x24: ['fload_2'],
  0x25: ['fload_3'],
  0x26: ['dload_0'],
  0x27: ['dload_1'],
  0x28: ['dload_2'],
  0x29: ['dload_3'],
  0x2a: ['aload_0'],
  0x2b: ['aload_1'],
  0x2c: ['aload_2'],
  0x2d: ['aload_3'],
  0x2e: ['iaload'],
  0x2f: ['laload'],
  0x30: ['faload'],
  0x31: ['daload'],
  0x32: ['aaload'],
  0x33: ['baload'],
  0x34: ['caload'],
  0x35: ['saload'],
  0x36: ['istore', 'u8'],
  0x37: ['lstore', 'u8'],
  0x38: ['fstore', 'u8'],
  0x39: ['dstore', 'u8'],
  0x3a: ['astore', 'u8'],
  0x3b: ['istore_0'],
  0x3c: ['istore_1'],
  0x3d: ['istore_2'],
  0x3e: ['istore_3'],
  0x3f: ['lstore_0'],
  0x40: ['lstore_1'],
  0x41: ['lstore_2'],
  0x42: ['lstore_3'],
  0x43: ['fstore_0'],
  0x44: ['fstore_1'],
  0x45: ['fstore_2'],
  0x46: ['fstore_3'],
  0x47: ['dstore_0'],
  0x48: ['dstore_1'],
  0x49: ['dstore_2'],
  0x4a: ['dstore_3'],
  0x4b: ['astore_0'],
  0x4c: ['astore_1'],
  0x4d: ['astore_2'],
  0x4e: ['astore_3'],
  0x4f: ['iastore'],
  0x50: ['lastore'],
  0x51: ['fastore'],
  0x52: ['dastore'],
  0x53: ['aastore'],
  0x54: ['bastore'],
  0x55: ['castore'],
  0x56: ['sastore'],
  0x57: ['pop'],
  0x58: ['pop2'],
  0x59: ['dup'],
  0x5a: ['dup_x1'],
  0x5b: ['dup_x2'],
  0x5c: ['dup2'],
  0x60: ['iadd'],
  0x64: ['isub'],
  0x68: ['imul'],
  0x6c: ['idiv'],
  0x70: ['irem'],
  0x74: ['ineg'],
  0x61: ['ladd'],
  0x65: ['lsub'],
  0x69: ['lmul'],
  0x62: ['fadd'],
  0x66: ['fsub'],
  0x6a: ['fmul'],
  0x6e: ['fdiv'],
  0x76: ['fneg'],
  0x63: ['dadd'],
  0x67: ['dsub'],
  0x6b: ['dmul'],
  0x6f: ['ddiv'],
  0x84: ['iinc', 'u8s8'],
  0x85: ['i2l'],
  0x86: ['i2f'],
  0x87: ['i2d'],
  0x88: ['l2i'],
  0x89: ['l2f'],
  0x8a: ['l2d'],
  0x8b: ['f2i'],
  0x8c: ['f2l'],
  0x8d: ['f2d'],
  0x8e: ['d2i'],
  0x8f: ['d2l'],
  0x90: ['d2f'],
  0x94: ['lcmp'],
  0x95: ['fcmpl'],
  0x96: ['fcmpg'],
  0x97: ['dcmpl'],
  0x98: ['dcmpg'],
  0x99: ['ifeq', 'i16'],
  0x9a: ['ifne', 'i16'],
  0x9b: ['iflt', 'i16'],
  0x9c: ['ifge', 'i16'],
  0x9d: ['ifgt', 'i16'],
  0x9e: ['ifle', 'i16'],
  0x9f: ['if_icmpeq', 'i16'],
  0xa0: ['if_icmpne', 'i16'],
  0xa1: ['if_icmplt', 'i16'],
  0xa2: ['if_icmpge', 'i16'],
  0xa3: ['if_icmpgt', 'i16'],
  0xa4: ['if_icmple', 'i16'],
  0xa5: ['if_acmpeq', 'i16'],
  0xa6: ['if_acmpne', 'i16'],
  0xa7: ['goto', 'i16'],
  0xac: ['ireturn'],
  0xad: ['lreturn'],
  0xae: ['freturn'],
  0xaf: ['dreturn'],
  0xb0: ['areturn'],
  0xb1: ['return'],
  0xb2: ['getstatic', 'u16'],
  0xb3: ['putstatic', 'u16'],
  0xb4: ['getfield', 'u16'],
  0xb5: ['putfield', 'u16'],
  0xb6: ['invokevirtual', 'u16'],
  0xb7: ['invokespecial', 'u16'],
  0xb8: ['invokestatic', 'u16'],
  0xb9: ['invokeinterface', 'u16u8u8'],
  0xba: ['invokedynamic', 'u16u16u16'],
  0xbb: ['new', 'u16'],
  0xbc: ['newarray', 'u8'],
  0xbd: ['anewarray', 'u16'],
  0xbe: ['arraylength'],
  0xbf: ['athrow'],
  0xc0: ['checkcast', 'u16'],
  0xc1: ['instanceof', 'u16'],
  0xc6: ['ifnull', 'i16'],
  0xc7: ['ifnonnull', 'i16'],
  0xc8: ['goto_w', 'i32'],
};

function u1(view, offset) {
  return view.getUint8(offset);
}
function u2(view, offset) {
  return view.getUint16(offset);
}
function u4(view, offset) {
  return view.getUint32(offset);
}

export function parseClassFile(input) {
  const bytes = new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = u4(view, 0);
  if (magic !== 0xcafebabe) {
    throw new Error(
      'Not a class file magic=' + magic.toString(16) + ' len=' + bytes.length,
    );
  }
  let o = 8;
  const cpCount = u2(view, o);
  o += 2;
  const cp = new Array(cpCount);
  for (let i = 1; i < cpCount; i += 1) {
    const tag = u1(view, o);
    o += 1;
    if (tag === 1) {
      const len = u2(view, o);
      o += 2;
      cp[i] = { tag, value: new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(o, o + len)) };
      o += len;
    } else if (tag === 3) {
      cp[i] = { tag, value: view.getInt32(o) };
      o += 4;
    } else if (tag === 4) {
      cp[i] = { tag, value: view.getFloat32(o) };
      o += 4;
    } else if (tag === 5 || tag === 6) {
      cp[i] = { tag, value: view.getBigInt64(o) };
      o += 8;
      i += 1;
    } else if (tag === 7 || tag === 8 || tag === 16 || tag === 19 || tag === 20) {
      cp[i] = { tag, value: u2(view, o) };
      o += 2;
    } else if (tag === 9 || tag === 10 || tag === 11 || tag === 12 || tag === 17 || tag === 18) {
      cp[i] = { tag, a: u2(view, o), b: u2(view, o + 2) };
      o += 4;
    } else if (tag === 15) {
      cp[i] = { tag, kind: u1(view, o), value: u2(view, o + 1) };
      o += 3;
    } else {
      throw new Error(`Unsupported constant pool tag ${tag}`);
    }
  }
  const access = u2(view, o);
  o += 2;
  const thisClass = u2(view, o);
  o += 2;
  const superClass = u2(view, o);
  o += 2;
  const ifaceCount = u2(view, o);
  o += 2 + ifaceCount * 2;
  const fieldCount = u2(view, o);
  o += 2;
  const skipAttributes = () => {
    const n = u2(view, o);
    o += 2;
    for (let i = 0; i < n; i += 1) {
      o += 2;
      const len = u4(view, o);
      o += 4 + len;
    }
  };
  const skipMembers = (count) => {
    for (let i = 0; i < count; i += 1) {
      o += 6;
      skipAttributes();
    }
  };
  skipMembers(fieldCount);
  const methodCount = u2(view, o);
  o += 2;
  const methods = [];
  for (let i = 0; i < methodCount; i += 1) {
    const flags = u2(view, o);
    const nameIndex = u2(view, o + 2);
    const descIndex = u2(view, o + 4);
    o += 6;
    const attrCount = u2(view, o);
    o += 2;
    let code = null;
    for (let a = 0; a < attrCount; a += 1) {
      const attrName = u2(view, o);
      const len = u4(view, o + 2);
      o += 6;
      const name = cp[attrName]?.value;
      if (name === 'Code') {
        const maxStack = u2(view, o);
        const maxLocals = u2(view, o + 2);
        const codeLen = u4(view, o + 4);
        const codeBytes = bytes.subarray(o + 8, o + 8 + codeLen);
        code = { maxStack, maxLocals, code: codeBytes };
      }
      o += len;
    }
    methods.push({
      flags,
      name: cp[nameIndex]?.value,
      desc: cp[descIndex]?.value,
      code,
    });
  }
  const utf = (index) => cp[index]?.value;
  const className = (() => {
    const cls = cp[thisClass];
    return utf(cls?.value)?.replaceAll('/', '.') ?? '';
  })();
  const superName = (() => {
    const cls = cp[superClass];
    return utf(cls?.value)?.replaceAll('/', '.') ?? '';
  })();
  return { cp, utf, className, superName, methods, access };
}

function decodeBytecode(codeBytes, cp, utf) {
  const view = new DataView(codeBytes.buffer, codeBytes.byteOffset, codeBytes.byteLength);
  const ops = [];
  let i = 0;
  while (i < codeBytes.length) {
    const start = i;
    const opcode = codeBytes[i];
    i += 1;
    const spec = OP[opcode];
    if (!spec) throw new Error(`Unsupported opcode 0x${opcode.toString(16)}`);
    const [op, kind] = spec;
    const operands = [];
    let note = '';
    if (kind === 'u8') operands.push(codeBytes[i]);
    else if (kind === 'i8') operands.push((codeBytes[i] << 24) >> 24);
    else if (kind === 'u16') operands.push((codeBytes[i] << 8) | codeBytes[i + 1]);
    else if (kind === 'i16') operands.push(((codeBytes[i] << 8) | codeBytes[i + 1]) << 16 >> 16);
    else if (kind === 'i32')
      operands.push(
        (codeBytes[i] << 24) |
          (codeBytes[i + 1] << 16) |
          (codeBytes[i + 2] << 8) |
          codeBytes[i + 3],
      );
    else if (kind === 'u8s8') {
      operands.push(codeBytes[i], (codeBytes[i + 1] << 24) >> 24);
    } else if (kind === 'u16u8u8') {
      operands.push((codeBytes[i] << 8) | codeBytes[i + 1], codeBytes[i + 2], codeBytes[i + 3]);
    }
    if (kind === 'u8' || kind === 'i8') i += 1;
    else if (kind === 'u16' || kind === 'i16' || kind === 'u8s8') i += 2;
    else if (kind === 'i32' || kind === 'u16u8u8') i += 4;
    else if (kind === 'u16u16u16') i += 6;
    if (op === 'ldc' || op === 'ldc_w' || op === 'ldc2_w') {
      const entry = cp[operands[0]];
      if (entry?.tag === 3) note = `int ${entry.value}`;
      else if (entry?.tag === 4) note = `float ${entry.value}`;
      else if (entry?.tag === 5) note = `long ${entry.value}`;
      else if (entry?.tag === 6) note = `double ${Number(entry.value)}`;
      else if (entry?.tag === 8) note = `String ${utf(entry.value) ?? ''}`;
      else throw new Error(`Unsupported ldc constant tag ${entry?.tag}`);
    } else if (
      op === 'new' ||
      op === 'anewarray' ||
      op === 'checkcast' ||
      op === 'instanceof'
    ) {
      const cls = cp[operands[0]];
      note = `class ${utf(cls?.value)?.replaceAll('/', '.') ?? ''}`;
    } else if (op.startsWith('invoke') || op === 'getstatic' || op === 'putstatic' || op === 'getfield' || op === 'putfield') {
      const ref = cp[operands[0]];
      const nat = cp[ref?.b];
      const ownerCls = cp[ref?.a];
      const owner = utf(ownerCls?.value)?.replaceAll('/', '.') ?? '';
      const name = utf(nat?.a) ?? '';
      const desc = utf(nat?.b) ?? '';
      const kind = op.startsWith('invoke') ? 'Method' : 'Field';
      note = `${kind} ${owner}.${name}:${desc}`;
    } else if (op === 'tableswitch' || op === 'lookupswitch') {
      // Align to 4-byte boundary from method start (start offset after opcode).
      const pad = (4 - ((start + 1) % 4)) % 4;
      i = start + 1 + pad;
      const defaultOffset = view.getInt32(i);
      i += 4;
      const switchTargets = { default: start + defaultOffset };
      if (op === 'tableswitch') {
        const low = view.getInt32(i);
        const high = view.getInt32(i + 4);
        i += 8;
        for (let k = low; k <= high; k += 1) {
          const off = view.getInt32(i);
          i += 4;
          switchTargets[k] = start + off;
        }
      } else {
        const n = view.getInt32(i);
        i += 4;
        for (let k = 0; k < n; k += 1) {
          const match = view.getInt32(i);
          const off = view.getInt32(i + 4);
          i += 8;
          switchTargets[match] = start + off;
        }
      }
      ops.push({ op, switchTargets, offset: start });
      continue;
    }
    if (op.startsWith('goto') || op.startsWith('if')) {
      // Branch targets are relative to instruction start.
      if (operands.length === 1) operands[0] = start + operands[0];
    }
    ops.push({ op, operands, note, offset: start });
  }
  return ops;
}

const argumentTypes = (descriptor) =>
  descriptor
    .slice(1, descriptor.indexOf(')'))
    .match(/\[*(?:[BCDFIJSZ]|L[^;]+;)/g) ?? [];

function newBone(type = 'ModelPart') {
  return {
    type,
    fields: {},
    cubes: [],
    pivot: [0, 0, 0],
    rotation: [0, 0, 0],
    uv: [0, 0],
  };
}

export function parseJavaModelFromClass(bytes, resolveClass, depth = 0) {
  if (depth > 8) throw new Error('Entity model inheritance exceeded limit');
  const parsed = parseClassFile(bytes);
  const { className, methods, cp, utf } = parsed;
  const ctor = methods.find(
    (m) =>
      m.name === '<init>' &&
      m.code &&
      /^(?:\(\)|\((?:Z|I|F|D|B|S|J)+\))V$/.test(m.desc),
  );
  const createLayer = methods.find(
    (m) => m.name === 'createBodyLayer' && m.code,
  );
  const createMesh = methods.find((m) => m.name === 'createMesh' && m.code);
  // Geometry often lives in createMesh (vanilla/mod builders), not the ModelPart ctor.
  const target = createMesh ?? ctor ?? createLayer;
  if (!target) throw new Error(`No supported model constructor: ${className}`);
  const ops = decodeBytecode(target.code.code, cp, utf);
  const defaults =
    target === ctor ? argumentTypes(ctor.desc).map(() => 0) : [];
  const self = { type: className, fields: {} };
  // Static createBodyLayer has no `this` local slot.
  const locals = target === createLayer && !ctor ? [] : [self, ...defaults];
  const stack = [];
  const bones = [];
  const pop = () => {
    if (!stack.length) throw new Error('Invalid construction stack');
    return stack.pop();
  };
  const offsets = new Map(ops.map((op, i) => [op.offset, i]));
  let complete = false;
  let steps = 0;
  for (let ip = 0; ip < ops.length; ip += 1) {
    if (++steps > 80000) throw new Error('Entity constructor exceeded instruction limit');
    const ins = ops[ip];
    const { op, operands = [], note = '' } = ins;
    if (op === 'return' || op === 'areturn') {
      complete = true;
      break;
    }
    if (op === 'tableswitch' || op === 'lookupswitch') {
      const value = pop();
      const table = ins.switchTargets;
      const target = offsets.get(table[value] ?? table.default);
      if (target === undefined) throw new Error('Invalid entity constructor switch jump');
      ip = target - 1;
    } else if (op === 'goto' || op === 'goto_w') {
      const target = offsets.get(operands[0]);
      if (target === undefined) throw new Error('Invalid entity constructor jump');
      ip = target - 1;
    } else if (/^if(?:_icmp|_acmp|null|nonnull)?(eq|ne|lt|ge|gt|le)?$/.test(op) || op === 'ifnull' || op === 'ifnonnull') {
      let jump = false;
      if (op === 'ifnull') jump = pop() == null;
      else if (op === 'ifnonnull') jump = pop() != null;
      else if (op.startsWith('if_icmp') || op.startsWith('if_acmp')) {
        const b = pop();
        const a = pop();
        if (op.startsWith('if_acmp')) jump = op.endsWith('ne') ? a !== b : a === b;
        else
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
      } else {
        const a = pop();
        if (typeof a !== 'number') throw new Error('Unknown entity constructor branch');
        jump = op.endsWith('eq')
          ? a === 0
          : op.endsWith('ne')
            ? a !== 0
            : op.endsWith('lt')
              ? a < 0
              : op.endsWith('ge')
                ? a >= 0
                : op.endsWith('gt')
                  ? a > 0
                  : a <= 0;
      }
      if (jump) {
        const target = offsets.get(operands[0]);
        if (target === undefined) throw new Error('Invalid entity constructor jump');
        ip = target - 1;
      }
    } else if (/^[aifdl]load(?:_\d+)?$/.test(op)) {
      const slot = op.includes('_') ? Number(op.split('_')[1]) : operands[0];
      stack.push(locals[slot]);
    } else if (/^[aifdl]store(?:_\d+)?$/.test(op)) {
      const slot = op.includes('_') ? Number(op.split('_')[1]) : operands[0];
      locals[slot] = pop();
    } else if (/^[if]const_/.test(op)) {
      stack.push(op.endsWith('m1') ? -1 : Number(op.split('_')[1]));
    } else if (op === 'bipush' || op === 'sipush') stack.push(operands[0]);
    else if (op === 'aconst_null') stack.push(null);
    else if (op === 'ldc' || op === 'ldc_w' || op === 'ldc2_w') {
      if (/^(float|double|int|long) /.test(note))
        stack.push(Number(note.replace(/^\w+ /, '').replace(/[fdl]$/, '')));
      else if (note.startsWith('String ')) stack.push(note.slice(7));
      else throw new Error(`Unsupported model constant: ${note}`);
    } else if (op === 'new') stack.push(newBone(note.replace(/^class /, '')));
    else if (op === 'anewarray' || op === 'newarray') {
      const length = pop();
      if (!Number.isInteger(length) || length < 0 || length > 10000)
        throw new Error('Invalid model array length');
      stack.push(Array(length).fill(op === 'anewarray' ? null : 0));
    } else if (/^[aifdlbcs]aload$/.test(op)) {
      const index = pop();
      const array = pop();
      if (!Array.isArray(array) || !Number.isInteger(index) || index < 0 || index >= array.length)
        throw new Error('Invalid model array read');
      stack.push(array[index]);
    } else if (/^[aifdlbcs]astore$/.test(op)) {
      const value = pop();
      const index = pop();
      const array = pop();
      if (!Array.isArray(array) || !Number.isInteger(index) || index < 0 || index >= array.length)
        throw new Error('Invalid model array write');
      array[index] = value;
    } else if (op === 'arraylength') {
      const array = pop();
      if (!Array.isArray(array)) throw new Error('Unknown model array');
      stack.push(array.length);
    } else if (op === 'dup') stack.push(stack[stack.length - 1]);
    else if (op === 'dup_x1') {
      const a = pop();
      const b = pop();
      stack.push(a, b, a);
    } else if (op === 'pop') pop();
    else if (op === 'getstatic' && /:L[^;]+;$/.test(note)) stack.push({ type: note, fields: {} });
    else if (op === 'getfield' || op === 'putfield') {
      const field = note.replace(/^Field /, '').split(':')[0].split('.').pop();
      if (op === 'getfield') stack.push(pop()?.fields?.[field]);
      else {
        const value = pop();
        const receiver = pop();
        if (!receiver) throw new Error('Unknown field receiver');
        receiver.fields[field] = value;
        if (receiver === self && value?.cubes && !value.name) value.name = field;
      }
    } else if (/^[ifdl](add|sub|mul|div)$/.test(op)) {
      const b = pop();
      const a = pop();
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
      const b = pop();
      const a = pop();
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
    else if (/^[ifdl]2[ifdl]$/.test(op) || op === 'checkcast' || op === 'iinc') continue;
    else if (op.startsWith('invoke')) {
      const call = note.match(/(?:InterfaceMethod|Method) (.+):(\(.*\).+)$/);
      if (!call) {
        // Unexpected call shape — do not abort the whole model.
        continue;
      }
      let name = call[1].split('.').pop().replaceAll('"', '');
      // Mojang/intermediary obfuscated names for model builders (1.20.x).
      const OBF = {
        m_171514_: 'texOffs',
        m_171481_: 'addBox',
        m_171488_: 'addBox',
        m_171506_: 'addBox',
        m_171558_: 'mirror',
        m_171599_: 'addOrReplaceChild',
        m_171419_: 'offset',
        m_171423_: 'offsetAndRotation',
        m_171576_: 'getRoot',
        m_171565_: 'create',
        m_170681_: 'createMesh',
        m_171324_: 'getChild',
      };
      if (OBF[name]) name = OBF[name];
      const ownerFull = call[1].includes('.')
        ? call[1].slice(0, call[1].lastIndexOf('.')).replaceAll('/', '.')
        : className;
      const types = argumentTypes(call[2]);
      const args = Array.from({ length: types.length }, pop).reverse();
      const receiver = op === 'invokestatic' ? null : pop();
      let returned;
      if (
        name === '<init>' &&
        receiver === self &&
        ownerFull !== className &&
        !/(?:^|\.)(?:Object|AdvancedEntityModel|EntityModel|AgeableListModel|ListModel)$/.test(
          ownerFull,
        )
      ) {
        if (!resolveClass) throw new Error(`Missing inherited entity geometry: ${ownerFull}`);
        const parentBytes = resolveClass(ownerFull);
        if (!parentBytes) throw new Error(`Missing inherited entity geometry: ${ownerFull}`);
        let parent = null;
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
        }
      } else if (
        name === 'toRadians' ||
        (ownerFull.endsWith('.Maths') && name === 'rad')
      ) {
        if (args.length !== 1 || !Number.isFinite(args[0]))
          throw new Error('Invalid entity angle conversion');
        returned = (args[0] * Math.PI) / 180;
        if (name === 'rad') returned = Math.fround(returned);
      } else if (name === '<init>') {
          console.error('INIT', ownerFull, 'recvType', receiver?.type, 'args', args);
        if (
          /(?:^|[./])(?:AdvancedModelBox|AdvancedModelRenderer|AnimatedModelRenderer|ModelPart)$/.test(
            receiver?.type ?? '',
          )
        ) {
        if (typeof args[1] === 'string') receiver.name = args[1];
        if (typeof args[1] === 'number' && typeof args[2] === 'number')
          receiver.uv = args.slice(1, 3);
        if (receiver?.cubes) bones.push(receiver);
        }
      } else if (name === 'setPos' || name === 'setRotationPoint') {
        receiver.pivot = args.slice(0, 3);
      } else if (name === 'addChild') args[0].parent = receiver;
      else if (name === 'setTextureOffset' || name === 'texOffs' || name === 'setTexOffs')
        receiver.uv = args.slice(0, 2);
      else if (name === 'setRotationAngle' || name === 'setRotateAngle' || name === 'setRot')
        args[0].rotation = args.slice(1, 4);
      else if (name === 'addBox' || name === 'addBoxVoxel') {
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
      } else if (name === 'create' && ownerFull.endsWith('CubeListBuilder')) {
        returned = newBone('CubeListBuilder');
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
      } else if (name === 'create' && ownerFull.endsWith('LayerDefinition')) {
        // LayerDefinition.create(mesh, textureWidth, textureHeight)
        if (Number.isFinite(args[1])) self.fields.texWidth = args[1];
        if (Number.isFinite(args[2])) self.fields.texHeight = args[2];
        returned = { type: 'LayerDefinition' };
      }
      const returns = call[2].slice(call[2].indexOf(')') + 1);
      if (returns !== 'V') {
        if (returned !== undefined) stack.push(returned);
        else if (/^[BCDFIJSZ]$/.test(returns)) stack.push(0);
        else stack.push(receiver ?? { type: returns, fields: {} });
      }
    } else if (op === 'invokedynamic') {
      // Rare in model builders (lambdas); geometry is not produced here.
      continue;
    } else throw new Error(`Unsupported model instruction ${op}`);
  }
    console.error('END complete', complete, 'bones', bones.length, 'cubes', bones.map((b) => b.cubes.length));
  if (!complete || !bones.some((bone) => bone.cubes.length))
    throw new Error('No complete entity geometry complete=' + complete + ' bones=' + bones.length + ' cubes=' + bones.map((b) => b.cubes.length).join(','));
  const fieldName = (bone) =>
    Object.entries(self.fields).find(([, value]) => value === bone)?.[0];
  const boneName = (bone) => fieldName(bone) ?? bone.name ?? `bone${bones.indexOf(bone)}`;
  return {
    format: 'java',
    textureWidth: self.fields.texWidth ?? self.fields.textureWidth ?? 64,
    textureHeight: self.fields.texHeight ?? self.fields.textureHeight ?? 32,
    bones: bones.map((bone) => ({
      name: boneName(bone),
      field: fieldName(bone),
      parent: bone.parent ? boneName(bone.parent) : undefined,
      pivot: bone.pivot.map((n) => Math.fround(n)),
      rotation: bone.rotation.map((n) => Math.fround(n)),
      cubes: bone.cubes.map((cube) => ({
        origin: cube.origin.map((n) => Math.fround(n)),
        size: cube.size.map((n) => Math.fround(n)),
        uv: cube.uv.map((n) => Math.fround(n)),
        inflate: Math.fround(cube.inflate),
        mirror: cube.mirror,
      })),
    })),
  };
}
