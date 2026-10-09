import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const sourceDir = path.join(root, 'public', 'stat-icons');
const outputDir = path.join(root, '.local', 'stat-icons-webp');
const manifestPath = path.join(root, '.local', 'stat-icon-build.json');

async function listPngs(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const file = path.join(dir, entry.name);
      return entry.isDirectory()
        ? listPngs(file)
        : entry.isFile() && path.extname(entry.name).toLowerCase() === '.png'
        ? [file]
        : [];
    }),
  );
  return files.flat().sort();
}

const files = await listPngs(sourceDir);
const relativeFiles = files.map((file) =>
  path.relative(sourceDir, file).split(path.sep).join('/'),
);
const sourceSizes = await Promise.all(
  files.map(async (file) => (await stat(file)).size),
);
const sourceBytes = sourceSizes.reduce((sum, bytes) => sum + bytes, 0);

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

let nextFile = 0;
let convertedBytes = 0;
let exactFiles = 0;
let completedFiles = 0;
const mismatches = [];
const failures = [];

async function convertWorker() {
  while (nextFile < files.length) {
    const index = nextFile;
    nextFile += 1;
    const input = files[index];
    const relative = relativeFiles[index];
    const output = path.join(outputDir, relative.replace(/\.png$/i, '.webp'));

    try {
      await mkdir(path.dirname(output), { recursive: true });
      const metadata = await sharp(input).metadata();
      if (metadata.depth !== 'uchar') {
        mismatches.push(relative);
        continue;
      }
      const result = await sharp(input)
        .keepMetadata()
        .webp({ lossless: true, exact: true, effort: 5 })
        .toFile(output);
      const [sourcePixels, outputPixels] = await Promise.all([
        sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
        sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      ]);
      const samePixels =
        sourcePixels.info.width === outputPixels.info.width &&
        sourcePixels.info.height === outputPixels.info.height &&
        sourcePixels.info.channels === outputPixels.info.channels &&
        sourcePixels.data.equals(outputPixels.data);
      if (!samePixels) {
        await rm(output, { force: true });
        mismatches.push(relative);
        continue;
      }
      exactFiles += 1;
      convertedBytes += result.size;
    } catch (error) {
      await rm(output, { force: true });
      failures.push({
        file: relative,
        reason:
          error instanceof Error ? error.message : 'unknown conversion error',
      });
    } finally {
      completedFiles += 1;
      if (completedFiles % 1000 === 0 || completedFiles === files.length)
        console.log(
          `Checked ${completedFiles}/${files.length} statistic icons.`,
        );
    }
  }
}

await Promise.all(
  Array.from({ length: Math.min(4, files.length) }, () => convertWorker()),
);

const pngFiles = [
  ...new Set([...mismatches, ...failures.map((failure) => failure.file)]),
].sort();
const fallbackBytes = pngFiles.reduce((sum, relative) => {
  const index = relativeFiles.indexOf(relative);
  return sum + (index < 0 ? 0 : sourceSizes[index]);
}, 0);
const useWebp =
  files.length > 0 &&
  exactFiles + pngFiles.length === files.length &&
  convertedBytes + fallbackBytes < sourceBytes;
const manifest = {
  format: useWebp ? 'webp' : 'png',
  files: files.length,
  sourceBytes,
  convertedBytes,
  exactFiles,
  pngFiles: useWebp ? pngFiles : [],
  mismatches,
  failures,
};

await mkdir(path.dirname(manifestPath), { recursive: true });
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `Stat icons: ${
    files.length
  } PNG, ${sourceBytes} bytes; ${exactFiles} exact WebP, ${
    pngFiles.length
  } PNG fallback(s), ${
    convertedBytes + fallbackBytes
  } bytes packaged; build format: ${manifest.format}.`,
);
if (mismatches.length || failures.length) {
  console.log(
    `WebP fallback: ${mismatches.length} pixel/depth mismatch(es), ${failures.length} conversion failure(s).`,
  );
  for (const file of mismatches.slice(0, 5)) console.log(`Mismatch: ${file}`);
  for (const failure of failures.slice(0, 5))
    console.log(`Conversion failed: ${failure.file} (${failure.reason})`);
}
