/**
 * Compare two snapshot directories and report meaningful visual differences.
 *
 * A byte-exact SHA comparison is too strict: a couple of antialiased pixels can
 * differ between runs because some pages poll on a timer. This decodes both PNGs
 * and reports the share of differing pixels and the largest channel delta, so a
 * real regression (layout shift, colour change) is distinguishable from
 * sub-pixel noise.
 *
 *   node scripts/qa-compare-snapshots.mjs <before-dir> <after-dir> [tolerance]
 *
 * Default tolerance: fail when more than 0.01% of pixels differ OR any channel
 * changes by more than 2.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const MAX_DIFF_RATIO = 0.0001; // 0.01% of pixels
const MAX_CHANNEL_DELTA = 2;

function decode(file) {
  const buffer = fs.readFileSync(file);
  let offset = 8;
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

const [beforeDir, afterDir] = process.argv.slice(2);
if (!beforeDir || !afterDir) {
  console.error(
    'usage: node scripts/qa-compare-snapshots.mjs <before> <after>',
  );
  process.exit(2);
}

const names = fs
  .readdirSync(beforeDir)
  .filter((f) => f.endsWith('.png'))
  .sort();
let failures = 0;
let noise = 0;

for (const name of names) {
  const afterPath = path.join(afterDir, name);
  if (!fs.existsSync(afterPath)) {
    console.log(`MISSING in after: ${name}`);
    failures += 1;
    continue;
  }
  const a = decode(path.join(beforeDir, name));
  const b = decode(afterPath);
  if (a.width !== b.width || a.height !== b.height) {
    console.log(
      `LAYOUT CHANGE ${name}: ${a.width}x${a.height} -> ${b.width}x${b.height}`,
    );
    failures += 1;
    continue;
  }
  let differing = 0;
  let maxDelta = 0;
  for (let i = 0; i < a.pixels.length; i += 1) {
    const delta = Math.abs(a.pixels[i] - b.pixels[i]);
    if (delta > 0) {
      differing += 1;
      if (delta > maxDelta) maxDelta = delta;
    }
  }
  const ratio = differing / (a.width * a.height * a.channels);
  if (ratio > MAX_DIFF_RATIO || maxDelta > MAX_CHANNEL_DELTA) {
    console.log(
      `DIFFERS ${name}: ${(ratio * 100).toFixed(
        4,
      )}% pixels, max delta ${maxDelta}`,
    );
    failures += 1;
  } else if (differing) {
    console.log(
      `  noise ${name}: ${differing} channel(s), max delta ${maxDelta}`,
    );
    noise += 1;
  }
}

console.log(
  `\n${names.length} pages: ${failures} with real differences, ${noise} with sub-pixel noise`,
);
process.exitCode = failures ? 1 : 0;
