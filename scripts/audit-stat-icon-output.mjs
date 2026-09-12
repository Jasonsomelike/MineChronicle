import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';

// Independent checks of source pixels and the published catalog. This does not
// import the exporter, renderer, or atlas builder.
const { values } = parseArgs({
  options: {
    textures: { type: 'string', default: '.local/stat-textures' },
    frames: { type: 'string', default: '.local/stat-frames' },
    lookup: { type: 'string', default: '.local/stat-icon-lookup.json' },
    icons: { type: 'string', default: 'public/stat-icons' },
    catalog: {
      type: 'string',
      default: 'src-tauri/resources/stat-resources.json',
    },
    report: { type: 'string', default: '.local/stat-icon-output-audit.json' },
    image: { type: 'string', multiple: true, default: [] },
    'catalog-only': { type: 'boolean', default: false },
  },
});
sharp.concurrency(1);
const readJson = (file) =>
  JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const manifest = readJson(path.join(values.textures, 'manifest.json'));
const lookup = readJson(values.lookup);
const catalog = readJson(values.catalog);
const selectedImages = new Set(values.image);
assert.ok(!values['catalog-only'] || !selectedImages.size);
const report = {
  rows: Object.keys(catalog).length,
  rowsWithIcons: 0,
  publishedImages: 0,
  sourceFrames: 0,
  originalImages: 0,
  animatedFrames: 0,
  tintedFrames: 0,
  composites: 0,
  renderedModels: 0,
  entityVariants: 0,
  pixelChecks: 0,
  coverage: {},
  ...(values['catalog-only'] ? { catalogOnly: true } : {}),
  ...(selectedImages.size ? { selectedImages: [...selectedImages] } : {}),
  failures: [],
};
const safePng = (directory, name) => {
  assert.match(name, /^[a-f0-9]{64}\.png$/);
  return path.join(directory, name);
};
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
    ? Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, canonical(value[key])]),
      )
    : value;
const hash = (value) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
const rasterCache = new Map();
let rasterBytes = 0;
async function raster(file) {
  if (rasterCache.has(file)) return rasterCache.get(file);
  const { data, info } = await sharp(file, { limitInputPixels: 4096 ** 2 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4, `RGBA decoding: ${file}`);
  if (rasterBytes + data.length > 64 * 1024 ** 2) {
    rasterCache.clear();
    rasterBytes = 0;
  }
  const result = { data, width: info.width, height: info.height };
  rasterCache.set(file, result);
  rasterBytes += data.length;
  return result;
}
function samplePixels(width, height) {
  const total = width * height;
  if (total <= 65536) return Array.from({ length: total }, (_, i) => i);
  return [
    ...new Set([
      0,
      width - 1,
      total - width,
      total - 1,
      Math.floor(total / 2),
      ...Array.from({ length: 8192 }, (_, i) => Math.floor((i * total) / 8192)),
    ]),
  ];
}
function frameBounds(layer, original, entity) {
  const animation = entity ? null : layer.animation;
  let width = original.width;
  let height = original.height;
  let left = 0;
  let top = 0;
  if (animation) {
    width =
      animation.width ??
      (animation.height ? original.width : Math.min(width, height));
    height =
      animation.height ??
      (animation.width
        ? original.height
        : Math.min(original.width, original.height));
    const first = animation.frames?.[0] ?? 0;
    const index = typeof first === 'object' ? first.index : first;
    const columns = Math.floor(original.width / width);
    left = (index % columns) * width;
    top = Math.floor(index / columns) * height;
  }
  for (const number of [width, height, left, top])
    assert.ok(Number.isInteger(number) && number >= 0);
  assert.ok(
    width > 0 &&
      height > 0 &&
      left + width <= original.width &&
      top + height <= original.height,
  );
  return { width, height, left, top, animation };
}
function expectedPixel(frame, x, y) {
  const start = ((y + frame.top) * frame.original.width + x + frame.left) * 4;
  const pixel = [...frame.original.data.subarray(start, start + 4)];
  if (frame.tint != null) {
    const color = frame.tint.toString(16).padStart(6, '0');
    for (let channel = 0; channel < 3; channel++) {
      const multiplier =
        Number.parseInt(color.slice(channel * 2, channel * 2 + 2), 16) / 255;
      pixel[channel] = Math.round(pixel[channel] * multiplier);
    }
  }
  return pixel;
}
function equalPixel(actual, expected, position, tolerance, context) {
  for (let channel = 0; channel < 4; channel++) {
    assert.ok(
      Math.abs(actual[position + channel] - expected[channel]) <= tolerance,
      `${context}, channel ${channel}: ${actual[position + channel]} != ${
        expected[channel]
      }`,
    );
  }
  report.pixelChecks++;
}
const framesChecked = new Set();
async function sourceFrame(layer, kind) {
  const file = safePng(values.textures, layer.file);
  const original = await raster(file);
  const entity = kind === 'chest' || kind === 'shield';
  const bounds = frameBounds(layer, original, entity);
  const tint =
    layer.tint == null || layer.tint === 0xffffff ? null : layer.tint;
  if (tint != null)
    assert.ok(Number.isInteger(tint) && tint >= 0 && tint <= 0xffffff);
  const frame = { ...bounds, tint, original, sourceFile: file };
  const id = hash({
    frame: 2,
    file: layer.file,
    animation: bounds.animation,
    ...(tint == null ? {} : { tint }),
  });
  if (!framesChecked.has(id)) {
    const prepared = await raster(safePng(values.frames, `${id}.png`));
    assert.equal(prepared.width, bounds.width, layer.source);
    assert.equal(prepared.height, bounds.height, layer.source);
    for (const pixel of samplePixels(bounds.width, bounds.height)) {
      const x = pixel % bounds.width;
      const y = Math.floor(pixel / bounds.width);
      equalPixel(
        prepared.data,
        expectedPixel(frame, x, y),
        pixel * 4,
        0,
        `source frame ${layer.source} @ ${x},${y}`,
      );
    }
    framesChecked.add(id);
    report.sourceFrames++;
    if (bounds.animation) report.animatedFrames++;
    if (tint != null) report.tintedFrames++;
  }
  return frame;
}

const entityImages = new Map();
for (const [identity, icon] of Object.entries(lookup)) {
  const separator = identity.indexOf('|entity:');
  if (separator < 0) continue;
  const key = identity.slice(separator + '|entity:'.length);
  const images = entityImages.get(key) ?? new Set();
  images.add(icon.image);
  entityImages.set(key, images);
}
const published = new Map();
for (const [stat, variants] of Object.entries(catalog)) {
  if (variants.some((entry) => entry.icon)) report.rowsWithIcons++;
  for (const entry of variants) {
    const icon = entry.icon;
    if (!icon) continue;
    if (/^minecraft:killed(?:_by)?\|/.test(stat)) {
      const key = stat.slice(stat.indexOf('|') + 1);
      assert.notEqual(icon.kind, 'item', `Item icon used for entity: ${stat}`);
      assert.ok(
        entityImages.get(key)?.has(icon.image),
        `Entity icon identity does not match ${stat}: ${icon.image}`,
      );
      report.entityVariants++;
    }
    const width = icon.width ?? icon.size;
    const height = icon.height ?? icon.size;
    assert.equal(icon.size, Math.max(width, height), stat);
    if (published.has(icon.image)) {
      const previous = published.get(icon.image);
      assert.deepEqual(
        [previous.width, previous.height, previous.kind],
        [width, height, icon.kind],
        stat,
      );
    } else published.set(icon.image, { ...icon, width, height });
  }
}
const recipes = new Map();
for (const [identity, icon] of Object.entries(lookup)) {
  if (published.has(icon.image) && manifest[identity])
    recipes.set(icon.image, { identity, job: manifest[identity] });
}
report.catalogImages = published.size;
for (const [image, icon] of published) {
  if (values['catalog-only']) continue;
  if (selectedImages.size && !selectedImages.has(image)) continue;
  try {
    const file = safePng(values.icons, image);
    const actual = await raster(file);
    assert.deepEqual(
      [actual.width, actual.height],
      [icon.width, icon.height],
      image,
    );
    assert.ok(
      actual.data.some((channel, i) => i % 4 === 3 && channel !== 0),
      `Invisible image: ${image}`,
    );
    const recipe = recipes.get(image);
    assert.ok(recipe, `No source recipe for ${image}`);
    const { identity, job } = recipe;
    const source = [];
    for (const layer of job.layers)
      source.push(await sourceFrame(layer, job.kind));
    for (const layer of Object.values(job.textures ?? {}))
      await sourceFrame(layer, job.kind);
    if (job.kind !== 'item') {
      assert.deepEqual([actual.width, actual.height], [256, 256], identity);
      report.renderedModels++;
    } else {
      assert.equal(
        actual.width,
        Math.max(...source.map((frame) => frame.width)),
        identity,
      );
      assert.equal(
        actual.height,
        Math.max(...source.map((frame) => frame.height)),
        identity,
      );
      const [first] = source;
      if (
        source.length === 1 &&
        first.tint == null &&
        first.left === 0 &&
        first.top === 0 &&
        first.width === first.original.width &&
        first.height === first.original.height
      ) {
        assert.ok(
          fs.readFileSync(file).equals(fs.readFileSync(first.sourceFile)),
          `Original bytes changed: ${identity}`,
        );
        report.originalImages++;
      } else {
        for (const pixel of samplePixels(actual.width, actual.height)) {
          const x = pixel % actual.width;
          const y = Math.floor(pixel / actual.width);
          let alpha = 0;
          let rgb = [0, 0, 0];
          for (const frame of source) {
            const sx = Math.min(
              frame.width - 1,
              Math.floor(((x + 0.5) * frame.width) / actual.width),
            );
            const sy = Math.min(
              frame.height - 1,
              Math.floor(((y + 0.5) * frame.height) / actual.height),
            );
            const rgba = expectedPixel(frame, sx, sy);
            const topAlpha = rgba[3] / 255;
            const combined = topAlpha + alpha * (1 - topAlpha);
            rgb = rgb.map((value, i) =>
              combined === 0
                ? 0
                : (rgba[i] * topAlpha + value * alpha * (1 - topAlpha)) /
                  combined,
            );
            alpha = combined;
          }
          const expected =
            source.length === 1
              ? expectedPixel(first, x, y)
              : [...rgb.map(Math.round), Math.round(alpha * 255)];
          equalPixel(
            actual.data,
            expected,
            pixel * 4,
            source.length === 1 ? 0 : 2,
            `${identity} @ ${x},${y}`,
          );
        }
        if (source.length > 1) report.composites++;
      }
    }
    report.publishedImages++;
  } catch (error) {
    report.failures.push({ image, message: String(error.message ?? error) });
  }
}
for (const image of selectedImages)
  if (!published.has(image))
    report.failures.push({ image, message: 'Selected image is not published' });

const groups = {
  gregtechScreenshot: [
    'brick_dust',
    'bronze_dust',
    'bronze_ingot',
    'bronze_plate',
    'bronze_small_fluid_pipe',
    'coal_dust',
    'coke_oven',
    'coke_oven_hatch',
    'copper_ingot',
    'copper_plate',
    'copper_single_wire',
    'copper_small_fluid_pipe',
    'fireclay_dust',
    'iron_bolt',
    'iron_crowbar',
    'iron_file',
    'iron_hammer',
    'iron_saw',
    'iron_screw',
    'iron_screwdriver',
    'iron_rod',
    'iron_wrench',
    'long_iron_rod',
    'lp_steam_alloy_smelter',
    'lp_steam_solid_boiler',
    'primitive_blast_furnace',
    'tin_ingot',
    'wood_dust',
    'wrought_iron_nugget',
  ].map((key) =>
    key === 'copper_ingot' ? 'minecraft:copper_ingot' : `gtceu:${key}`,
  ),
  draconicScreenshot: [
    'energy',
    'flight',
    'large_shield_capacity',
    'proj_accuracy',
    'proj_anti_immune',
    'proj_damage',
    'proj_penetration',
    'proj_velocity',
    'shield_capacity',
    'shield_control',
  ].map((key) => `draconicevolution:item_draconic_${key}`),
  entitySamples: [
    'minecraft:zombie',
    'minecraft:creeper',
    'minecraft:skeleton',
    'minecraft:cow',
    'minecraft:armadillo',
    'alexscaves:deep_one',
    'alexscaves:luxtructosaurus',
    'alexscaves:lanternfish',
    'alexsmobs:bison',
    'alexsmobs:soul_vulture',
    'ad_astra:corrupted_lunarian',
    'ad_astra:martian_raptor',
    'aether:valkyrie',
    'aether:aechor_plant',
    'crabbersdelight:crab',
    'crittersandcompanions:koi_fish',
  ],
};
for (const [name, keys] of Object.entries(groups)) {
  const items = keys.map((key) => {
    const stats = Object.entries(catalog).filter(
      ([id]) =>
        id.endsWith(`|${key}`) &&
        (name !== 'entitySamples' || /^minecraft:killed(?:_by)?\|/.test(id)),
    );
    const variants = stats.flatMap(([, entries]) => entries);
    return {
      key,
      rows: stats.length,
      variants: variants.length,
      icons: variants.filter((entry) => entry.icon).length,
      missingPacks: [
        ...new Set(
          variants
            .filter((entry) => !entry.icon)
            .flatMap((entry) => entry.packs),
        ),
      ],
    };
  });
  report.coverage[name] = {
    keys: keys.length,
    complete: items.filter(
      (item) => item.variants > 0 && item.icons === item.variants,
    ).length,
    items,
  };
}
fs.writeFileSync(values.report, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      ...report,
      coverage: Object.fromEntries(
        Object.entries(report.coverage).map(([key, value]) => [
          key,
          { keys: value.keys, complete: value.complete },
        ]),
      ),
      failures: report.failures.slice(0, 10),
    },
    null,
    2,
  ),
);
if (report.failures.length) process.exitCode = 1;
