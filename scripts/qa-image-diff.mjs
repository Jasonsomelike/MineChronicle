/**
 * Compare two PNG screenshots pixel by pixel and report where they differ.
 * Used to tell a real visual regression apart from screenshot nondeterminism.
 *
 *   node scripts/qa-image-diff.mjs <a.png> <b.png>
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

/** Minimal PNG decoder for the 8-bit RGBA/RGB output Chromium produces. */
function decode(file) {
  const buffer = fs.readFileSync(file);
  let offset = 8; // skip signature
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let position = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[position];
    position += 1;
    const line = raw.subarray(position, position + stride);
    position += stride;
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prior = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? out[x - channels] : 0;
      const b = prior ? prior[x] : 0;
      const c = prior && x >= channels ? prior[x - channels] : 0;
      let value = line[x];
      switch (filter) {
        case 1:
          value += a;
          break;
        case 2:
          value += b;
          break;
        case 3:
          value += (a + b) >> 1;
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default:
          break;
      }
      out[x] = value & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

const [fileA, fileB] = process.argv.slice(2);
if (!fileA || !fileB) {
  console.error('usage: node scripts/qa-image-diff.mjs <a.png> <b.png>');
  process.exit(2);
}

const a = decode(fileA);
const b = decode(fileB);
if (a.width !== b.width || a.height !== b.height) {
  console.log(`size differs: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  process.exit(1);
}

let differing = 0;
let minX = a.width;
let minY = a.height;
let maxX = -1;
let maxY = -1;
let maxDelta = 0;
for (let y = 0; y < a.height; y += 1) {
  for (let x = 0; x < a.width; x += 1) {
    const ia = (y * a.width + x) * a.channels;
    const ib = (y * b.width + x) * b.channels;
    let same = true;
    for (let c = 0; c < a.channels; c += 1) {
      const delta = Math.abs(a.pixels[ia + c] - b.pixels[ib + c]);
      if (delta > 0) {
        same = false;
        if (delta > maxDelta) maxDelta = delta;
      }
    }
    if (!same) {
      differing += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
}

const total = a.width * a.height;
console.log(`${fileA} vs ${fileB}`);
console.log(`  size: ${a.width}x${a.height}`);
console.log(
  `  differing pixels: ${differing} / ${total} (${(
    (differing / total) *
    100
  ).toFixed(4)}%)`,
);
if (differing) {
  console.log(`  bounding box: x ${minX}..${maxX}, y ${minY}..${maxY}`);
  console.log(`  max channel delta: ${maxDelta}`);
}
process.exitCode = differing ? 1 : 0;
