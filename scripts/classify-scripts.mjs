// Determine which scripts/ files are safe to archive into scripts/oneoff/.
//
// Safe means: no other script imports or reads it by name, and it is not
// referenced by package.json / README / docs / source. A script that merely
// references others with cwd-relative paths can still be moved, because those
// paths resolve from the working directory, not from the script's own location.
import fs from 'node:fs';
import path from 'node:path';

const scriptsDir = path.join(process.cwd(), 'scripts');
const files = fs
  .readdirSync(scriptsDir)
  .filter((f) => /\.(mjs|ps1|py|html|json)$/.test(f));

// Everything outside scripts/ that could name a script.
const outsideFiles = [
  'package.json',
  'README.md',
  ...fs
    .readdirSync(path.join(process.cwd(), 'docs'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join('docs', f)),
];
const outsideText = outsideFiles
  .map((f) => {
    try {
      return fs.readFileSync(path.join(process.cwd(), f), 'utf8');
    } catch {
      return '';
    }
  })
  .join('\n');

// Source tree references (src/ and src-tauri/).
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'target', 'gen', 'dist'].includes(entry.name))
        continue;
      walk(full, out);
    } else out.push(full);
  }
  return out;
}
const sourceText = [
  ...walk('src'),
  ...walk('src-tauri/src'),
  ...walk('src-tauri/tests'),
]
  .filter((f) => /\.(ts|tsx|rs)$/.test(f))
  .map((f) => {
    try {
      return fs.readFileSync(f, 'utf8');
    } catch {
      return '';
    }
  })
  .join('\n');

const allScriptText = files
  .map((f) => {
    try {
      return {
        file: f,
        text: fs.readFileSync(path.join(scriptsDir, f), 'utf8'),
      };
    } catch {
      return { file: f, text: '' };
    }
  })
  .filter(Boolean);

const referenced = new Set();
for (const { file, text } of allScriptText) {
  for (const other of files) {
    if (other === file) continue;
    // Any mention of the filename by another script counts as a reference.
    if (text.includes(other)) referenced.add(other);
  }
}
for (const f of files) {
  if (outsideText.includes(f) || sourceText.includes(f)) referenced.add(f);
}

// Shared library modules are imported widely; never archive them.
const sharedModules = new Set([
  'java-entity-runtime.mjs',
  'stat-entity-renderer.mjs',
  'stat-entity-java.mjs',
  'stat-entity-layer.mjs',
  'stat-vanilla-poses.mjs',
  'stat-icon-obj.mjs',
  'stat-icon-renderer.mjs',
  'stat-icon-renderer.html',
  'extract-class.ps1',
  'extract-png.ps1',
]);

// A script that imports a shared module with a *relative* specifier breaks if it
// moves, because `./x.mjs` resolves against the script's own directory. Such
// scripts must stay put (or have their imports rewritten).
const importsSharedRelatively = new Set();
for (const { file, text } of allScriptText) {
  for (const module of sharedModules) {
    if (module === file) continue;
    const relative = new RegExp(`['"]\\./${module.replace('.', '\\.')}['"]`);
    if (relative.test(text)) importsSharedRelatively.add(file);
  }
}

const safe = files.filter(
  (f) =>
    !referenced.has(f) &&
    !sharedModules.has(f) &&
    !importsSharedRelatively.has(f),
);
const unsafe = files.filter((f) => !safe.includes(f));

console.log(`total scripts: ${files.length}`);
console.log(
  `keep (referenced, shared, or relatively imports a shared module): ${unsafe.length}`,
);
console.log(`safe to archive (self-contained, unreferenced): ${safe.length}\n`);
console.log('ARCHIVE CANDIDATES:');
for (const f of safe) console.log('  ' + f);
console.log('\nSTAYS because it imports a shared module relatively:');
for (const f of [...importsSharedRelatively].sort()) console.log('  ' + f);
