import { cp, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const publicDir = path.join(root, 'public');
const outputDir = path.join(root, 'dist');
const manifest = JSON.parse(
  await readFile(path.join(root, '.local', 'stat-icon-build.json'), 'utf8'),
);

await mkdir(outputDir, { recursive: true });
await cp(publicDir, outputDir, {
  recursive: true,
  filter(source) {
    const relative = path.relative(publicDir, source);
    return (
      relative !== 'stat-icons' && !relative.startsWith(`stat-icons${path.sep}`)
    );
  },
});
const outputIcons = path.join(outputDir, 'stat-icons');
if (manifest.format === 'webp') {
  await cp(path.join(root, '.local', 'stat-icons-webp'), outputIcons, {
    recursive: true,
  });
  for (const file of manifest.pngFiles) {
    const destination = path.join(outputIcons, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(publicDir, 'stat-icons', file), destination);
  }
} else {
  await cp(path.join(publicDir, 'stat-icons'), outputIcons, {
    recursive: true,
  });
}

console.log(
  `Copied public assets with ${manifest.format} statistic icons (${
    manifest.pngFiles?.length ?? 0
  } PNG fallback(s)).`,
);
