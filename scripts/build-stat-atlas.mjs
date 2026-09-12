import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { createServer } from 'vite';

sharp.concurrency(1);
const read = (file) =>
  JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const directory = process.argv[2] ?? '.local/stat-textures';
const manifest = read(path.join(directory, 'manifest.json'));
const resources = read('.local/stat-catalog-draft.json');
const requests = read('.local/stat-icon-requests.json');
const output = path.resolve('public/stat-icons');
const cache = path.resolve('.local/stat-rendered');
const frames = path.resolve('.local/stat-frames');
for (const dir of [output, cache, frames])
  fs.mkdirSync(dir, { recursive: true });
const MODEL_SIZE = 256;
const ordered = (value) =>
  Array.isArray(value)
    ? value.map(ordered)
    : value && typeof value === 'object'
    ? Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((k) => [k, ordered(value[k])]),
      )
    : value;
const digest = (value) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(ordered(value)))
    .digest('hex');
const jobs = new Map(),
  lookup = new Map(),
  prepared = new Map(),
  failures = [];

async function frame(layer, entity = false) {
  const animation = entity ? null : layer.animation;
  const tint = layer.tint == null ? null : Number(layer.tint);
  if (tint != null && (!Number.isInteger(tint) || tint < 0 || tint > 0xffffff))
    throw new Error(`Invalid texture tint: ${layer.source}`);
  const tinted = tint != null && tint !== 0xffffff;
  const id = `${digest({
    frame: 2,
    file: layer.file,
    animation,
    ...(tinted ? { tint } : {}),
  })}.png`;
  if (prepared.has(id)) return prepared.get(id);
  const input = path.join(directory, layer.file);
  const image = sharp(input, {
    limitInputPixels: 4096 * 4096,
  });
  const meta = await image.metadata();
  let width = meta.width,
    height = meta.height,
    left = 0,
    top = 0;
  if (animation) {
    const square = Math.min(meta.width, meta.height);
    width = animation.width ?? (animation.height ? meta.width : square);
    height = animation.height ?? (animation.width ? meta.height : square);
    const first = animation.frames?.[0] ?? 0;
    const index = typeof first === 'number' ? first : first.index;
    if (
      !Number.isInteger(width) ||
      width <= 0 ||
      !Number.isInteger(height) ||
      height <= 0 ||
      !Number.isInteger(index) ||
      index < 0 ||
      width > meta.width ||
      height > meta.height
    )
      throw new Error(`Invalid animation frame: ${layer.source}`);
    const columns = Math.floor(meta.width / width);
    left = (index % columns) * width;
    top = Math.floor(index / columns) * height;
    if (top + height > meta.height)
      throw new Error(`Animation frame outside texture: ${layer.source}`);
  }
  const original =
    !tinted &&
    left === 0 &&
    top === 0 &&
    width === meta.width &&
    height === meta.height;
  if (!fs.existsSync(path.join(frames, id))) {
    if (original) fs.copyFileSync(input, path.join(frames, id));
    else if (tinted) {
      const { data } = await image
        .extract({ left, top, width, height })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const channels = [(tint >> 16) & 255, (tint >> 8) & 255, tint & 255];
      // Minecraft multiplies each texture channel by its registered material tint.
      for (let i = 0; i < data.length; i += 4)
        for (let channel = 0; channel < 3; channel++)
          data[i + channel] = Math.round(
            (data[i + channel] * channels[channel]) / 255,
          );
      await sharp(data, { raw: { width, height, channels: 4 } })
        .png()
        .toFile(path.join(frames, id));
    } else
      await image
        .extract({ left, top, width, height })
        .png()
        .toFile(path.join(frames, id));
  }
  const result = { file: id, width, height, original };
  prepared.set(id, result);
  return result;
}
for (const [id, source] of Object.entries(manifest)) {
  const job = structuredClone(source);
  const entity = source.kind === 'chest' || source.kind === 'shield';
  const layers = await Promise.all(
    source.layers.map((layer) => frame(layer, entity)),
  );
  const width =
    source.kind === 'item'
      ? Math.max(...layers.map((layer) => layer.width))
      : MODEL_SIZE;
  const height =
    source.kind === 'item'
      ? Math.max(...layers.map((layer) => layer.height))
      : MODEL_SIZE;
  if (job.textures)
    job.textures = Object.fromEntries(
      await Promise.all(
        Object.entries(source.textures).map(async ([key, value]) => [
          key,
          (await frame(value)).file,
        ]),
      ),
    );
  job.layers = layers.map((layer) => layer.file);
  const hash = digest({
    renderer:
      source.kind === 'item'
        ? 4
        : source.entityModel || source.entityParts
        ? 7
        : 6,
    width,
    height,
    job,
  });
  const image = `${hash}.png`;
  lookup.set(id, {
    image,
    size: Math.max(width, height),
    width,
    height,
    kind: source.kind,
    source: [...new Set(source.layers.map((l) => l.source))].join(' + '),
  });
  if (jobs.has(hash)) continue;
  const original =
    source.kind === 'item' && layers.length === 1 && layers[0].original
      ? source.layers[0].file
      : null;
  if (fs.existsSync(path.join(cache, image))) {
    jobs.set(hash, {
      ...job,
      hash,
      image,
      width,
      height,
      original,
      cached: true,
    });
    continue;
  }
  if (source.kind === 'item') {
    if (layers.length === 1)
      fs.copyFileSync(
        path.join(frames, layers[0].file),
        path.join(cache, image),
      );
    else {
      const composites = await Promise.all(
        layers.map(async (layer) => ({
          input: await sharp(path.join(frames, layer.file))
            .resize(width, height, { kernel: 'nearest', fit: 'fill' })
            .png()
            .toBuffer(),
        })),
      );
      await sharp({
        create: { width, height, channels: 4, background: '#00000000' },
      })
        .composite(composites)
        .png()
        .toFile(path.join(cache, image));
    }
  }
  jobs.set(hash, {
    ...job,
    hash,
    image,
    width,
    height,
    original,
    cached: fs.existsSync(path.join(cache, image)),
  });
}
const pending = [...jobs.values()].filter((j) => !j.cached);
fs.writeFileSync(
  '.local/stat-icon-lookup.json',
  JSON.stringify(Object.fromEntries(lookup)),
);
fs.writeFileSync('.local/stat-render-jobs.json', JSON.stringify(pending));
console.log(
  `Prepared ${jobs.size} unique icons; ${pending.length} models need rendering.`,
);

async function finalize() {
  const visible = new Set(),
    transparent = [];
  for (const job of jobs.values()) {
    const file = path.join(cache, job.image);
    if (!fs.existsSync(file)) continue;
    if (
      job.original &&
      !fs
        .readFileSync(file)
        .equals(fs.readFileSync(path.join(directory, job.original)))
    )
      throw new Error(`Original texture bytes changed: ${job.image}`);
    const { data, info } = await sharp(file)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.width !== job.width || info.height !== job.height)
      throw new Error(`Unexpected icon dimensions: ${job.image}`);
    if (
      data.some(
        (value, i) => i % info.channels === info.channels - 1 && value > 0,
      )
    )
      visible.add(job.image);
    else transparent.push(job.image);
    if ((visible.size + transparent.length) % 2000 === 0)
      console.log(`Validated ${visible.size + transparent.length} icon images`);
  }
  const requestKeys = new Map(
    requests.map((r) => [
      `${r.root}|${r.id}`,
      r.entity ? `entity:${r.key}` : r.key,
    ]),
  );
  const used = new Set();
  let withIcons = 0,
    translated = 0,
    supplemental = 0;
  for (const [id, variants] of Object.entries(resources)) {
    const unique = new Map();
    for (const entry of variants) {
      const key = requestKeys.get(`${entry.root}|${id}`);
      const icon = key ? lookup.get(`${entry.root}|${key}`) : null;
      // Invisible source textures must use the UI fallback, never a blank image.
      entry.icon = icon && visible.has(icon.image) ? icon : null;
      if (entry.icon) used.add(entry.icon.image);
      delete entry.root;
      const { packs, ...rest } = entry,
        fingerprint = JSON.stringify(ordered(rest));
      if (unique.has(fingerprint))
        unique.get(fingerprint).packs = [
          ...new Set([...unique.get(fingerprint).packs, ...packs]),
        ];
      else unique.set(fingerprint, entry);
    }
    resources[id] = [...unique.values()];
    if (resources[id].some((r) => r.icon)) withIcons++;
    if (resources[id].some((r) => r.label)) translated++;
    if (resources[id].every((r) => !r.label || r.origin === 'reviewed'))
      supplemental++;
  }
  if (requests.length && !withIcons)
    throw new Error('Refusing to publish an empty statistics icon catalog');
  for (const image of used)
    fs.copyFileSync(path.join(cache, image), path.join(output, image));
  // Only remove generated assets from this exact output directory.
  for (const file of fs.readdirSync(output))
    if (/^(?:atlas-\d+|[a-f0-9]{64})\.png$/.test(file) && !used.has(file))
      fs.unlinkSync(path.join(output, file));
  fs.writeFileSync(
    'src-tauri/resources/stat-resources.json',
    JSON.stringify(resources),
  );
  const report = {
    rows: Object.keys(resources).length,
    translated,
    supplemental,
    withIcons,
    icons: used.size,
    modelSize: MODEL_SIZE,
    original: [...jobs.values()].filter(
      (job) => used.has(job.image) && job.original,
    ).length,
    dimensions: [...jobs.values()]
      .filter((job) => used.has(job.image))
      .reduce((counts, job) => {
        const size = `${job.width}x${job.height}`;
        counts[size] = (counts[size] ?? 0) + 1;
        return counts;
      }, {}),
    failures,
    transparent,
  };
  fs.writeFileSync(
    '.local/stat-atlas-report.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
}

if (!pending.length) await finalize();
else {
  const pendingHashes = new Set(pending.map((j) => j.hash));
  const completedHashes = new Set();
  let finalizing;
  const receive = async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    try {
      let text = '';
      for await (const chunk of req) {
        text += chunk;
        if (text.length > 2 * 1024 * 1024)
          throw new Error('Render result too large');
      }
      const data = JSON.parse(text);
      if (data.done) {
        if (pendingHashes.size)
          throw new Error(`${pendingHashes.size} models have no result`);
        finalizing ??= finalize();
        await finalizing;
        res.writeHead(200).end('ok');
        setTimeout(() => {
          void server.close();
        }, 500);
        return;
      }
      // A headless browser may reload while Vite reconnects. Already accepted
      // results are idempotent; unrelated hashes are still rejected.
      if (completedHashes.has(data.hash)) {
        res.writeHead(200).end('ok');
        return;
      }
      if (!pendingHashes.has(data.hash)) throw new Error('Unknown render job');
      if (data.error) failures.push({ hash: data.hash, error: data.error });
      else {
        const png = Buffer.from(data.png, 'base64');
        const metadata = await sharp(png).metadata();
        if (metadata.width !== MODEL_SIZE || metadata.height !== MODEL_SIZE)
          throw new Error('Unexpected render dimensions');
        fs.writeFileSync(path.join(cache, `${data.hash}.png`), png);
      }
      pendingHashes.delete(data.hash);
      completedHashes.add(data.hash);
      if (pendingHashes.size % 250 === 0)
        console.log(`${pendingHashes.size} models remaining`);
      res.writeHead(200).end('ok');
    } catch (error) {
      res.writeHead(400).end(String(error));
    }
  };
  const server = await createServer({
    plugins: [
      {
        name: 'statistics-render-output',
        configureServer(server) {
          server.middlewares.use('/__stat_render_result', receive);
        },
      },
    ],
    server: {
      host: '127.0.0.1',
      port: 1422,
      strictPort: true,
      watch: { ignored: ['**/.local/**', '**/public/stat-icons/**'] },
    },
  });
  await server.listen();
  console.log(
    'Render page: http://127.0.0.1:1422/scripts/stat-icon-renderer.html',
  );
}
