# Statistics Resources

The [0.10.7 audit](stat-icons-audit-0.10.7.md) records the full archive coverage,
model corrections, verification and remaining unsupported resources. That work
used static analysis and headless rendering without Computer Use.

The statistics view resolves names against the PCL instances that actually supplied
the selected player/world records. The generated catalog covers the 18,882 distinct
category/key pairs in the development archive. All have a display name; 417 pairs
depend on supplemental translations. The original registry IDs remain visible.

Version 0.10.5 expands original-texture and model icon coverage, including generated
machine materials and creature models. Both Dashboard rankings start with five
entries and expand independently in steps of five (5 → 10 → 15, up to the available
total). Changing the selected player or player combination resets both to five.

## Sources and Priority

1. The instance's mod JAR language files, enabled resource packs from `options.txt`,
   and local KubeJS/resources language files. Examples include ATM10's BBSMC pack,
   FTB Skies 2 and Create New Horizon's CFPA packs, and Mierno's KubeJS resources.
2. [CFPA Minecraft Mod Language Package](https://github.com/CFPAOrg/Minecraft-Mod-Language-Package),
   pinned at `aad4adb80ff9fb7423213bddddd1b7f6bf6606fe`. Minecraft version families are
   matched before using its Simplified Chinese language files.
3. [GregTechCEu/GregTech-Modern](https://github.com/GregTechCEu/GregTech-Modern/tree/0ae1a40e97485de8ca1d6b42547118de8b042291),
   branch 1.20.1, pinned at `0ae1a40e97485de8ca1d6b42547118de8b042291`.
   Material, tag-prefix, ore-host and tool templates reconstruct generated names.
4. The existing bundled Minecraft/mod language catalog.
5. Explicit supplemental Chinese translations, marked as such in the table.

The source expander lists the actual source instances, English name when available,
and translation archive/path. Different pack names for the same ID are retained.
No Minecraft, launcher, authentication or save files are modified by extraction.

Entity statistics (`killed`, `killed_by`, and their legacy equivalents) use a
separate entity resource identity, so a creature can never inherit an identically
named inventory item. Entity images use original instance textures and extracted
Java model constructors, LayerDefinition geometry, or GeckoLib/Bedrock geometry.
Adapters cover Ad Astra, Aether, Alex's Caves/Mobs and other compatible installed
mods. Vanilla geometry references are pinned to PrismarineJS/prismarine-viewer
`9e58a658aaeda34a8400210e4f0f583259a33aee` and Mojang/bedrock-samples
`736072450c26a7c67f07b1661f29d9a5ebaa14b1`; Java Enderman and Guardian rest poses
use their original model definitions. The corresponding licenses accompany the
resources. Statistics do not identify creature skins, equipment or animation
state; images show a representative skin and rest pose. Unsupported dynamic
models retain the neutral fallback instead of publishing guessed or partial meshes.

Draconic Evolution supports original module layers, tool PNGs and crystal/shard
OBJ geometry. GregTech uses the installed material registrations, original icon
sets and material colors, including GTCEu nested inside CTNH-Core. Modern
Industrialization machines combine their actual casing and inactive overlays.
These extraction adapters run only while generating resources, without loading
game classes or adding runtime scanning work.

## Icons and Units

16,296 category/key pairs have icons, supplied by 10,379 distinct PNG images.
5,067 single-layer icons need no frame crop and are byte-for-byte copies of the selected source PNG,
including its original resolution, aspect ratio and color metadata. Native images
range from 16 to 3,200 pixels; most are the game's original 16-pixel pixel art.
Multi-layer items are composited losslessly at the largest source-layer dimensions,
using nearest-neighbor scaling only for smaller layers. Animated textures use the
first frame selected by their own `.png.mcmeta`, including frame dimensions and
nonzero starting indices. Static non-square textures are never cropped to a square.

Blocks and entity items do not generally have a finished inventory PNG in game
resources. Their 4,523 published model images are rendered at 256 by 256 pixels from
original textures, inherited block elements, face UVs, rotations and inventory
transforms in the source instance's actual resource stack. Unsupported custom
loaders use the neutral package icon. These are
static registry representations; stats do not contain an item's NBT, custom model
state or dye data, and this is not a complete Minecraft item renderer.

Among the 615 distinct species recorded by modern `killed`/`killed_by` statistics,
300 have images across 28 namespaces. Unresolved dynamic models and incompatible
skin or geometry definitions retain the neutral fallback.

Both legacy `models/item` entry points and Minecraft 1.21.4+ `items` definitions
are resolved, including references directly to block models. Vanilla chest icons
use the selected instance's chest entity texture, composed from its lid, body and
latch UVs. Shields use their entity plate and handle. Sophisticated Storage chests
combine the default oak texture and the actual tier overlay. Air has no visible
texture and uses an explicit air symbol. Interaction statistics use explicit
object mappings in `scripts/stat-icon-aliases.json`, preserving their statistic
names, values and units.

Block geometry is generated with `@xmcl/model` and rendered using Three.js during
resource generation only. An adapter handles Minecraft's top-origin partial UVs,
UV quarter turns, element rescaling and translucent textures. Every generated image
is checked for its dimensions and visible alpha pixels before publication;
fully invisible source textures use the neutral fallback. Original static copies
also undergo byte-equality verification. The resource contract carries `width` and
`height`, with `size` retaining the maximum dimension for compatibility. Runtime
loads individual original images lazily; no 3D renderer enters the application bundle.
Individual images avoid decoding entire high-resolution atlases for a few rows.

Time is converted from 20 ticks per second; distances from centimeters to meters;
damage from tenths to damage points. Other known counters use blocks, items or
occurrences. Legacy formats have their own unit mappings. Unknown mod counters
keep their raw readings without guessed units. Integer math preserves totals above
JavaScript's safe-integer limit. Original readings are available on hover.
Data-version fields are displayed as metadata, never summed across worlds.

The reading-column button cycles through default, descending and ascending raw
integer readings across all filtered matches before pagination. Sorting preserves
128-bit integer precision; ties retain category/key order, and metadata or
non-integer values remain last in both directions. Changing the sort or filters
returns to the first page. Values with different units are not converted into a
common measure for sorting.

Category filters distinguish interactions, mined blocks, crafted/used/broken items,
pickups, drops, kills, deaths, general counters and other data. Legacy `stat.*` keys
map to the same groups. Counts apply the player/world scope, history mode and text
query before category filtering, sorting and pagination. Refreshes clamp stale page
offsets when the number of matches shrinks.

The UI displays original item textures with nearest-neighbor scaling and model
renders with standard downsampling. Clicking an image opens a larger preview with
the source dimensions. Application zoom is persisted from 75% to 175%; desktop
builds use native WebView zoom, and browser previews use CSS zoom. Popovers account
for the effective viewport, and the main metrics can expand above the category list.

Unit mappings were checked against Minecraft's `Stats` / `StatFormatter`
definitions, including `TIME`, `DISTANCE`, and `DIVIDE_BY_TEN`:
[reference source](https://github.com/mahtomedi/minecraft/blob/main/src/main/java/net/minecraft/stats/Stats.java).

## Rebuilding the Resource Catalog

The generation tools run only during development/resource refresh. Runtime opens
neither JARs nor resource-pack ZIPs and performs no translation network requests.
Names are loaded once; individual PNG images are loaded by the view when visible.
Java-model extraction requires a JDK with `javap` available on `PATH`; it inspects
the installed classes without executing game code.

The audit JSON input contains `roots` (`id`, `path`, `instances`) and `keys`
(`category`, `key`, `roots`). It can be built from the archive's normalized current
statistics without scanning the original saves. Personal paths and player records
are not included in the generated catalog.

```powershell
pwsh -File scripts/export-stat-assets.ps1 -Audit .local/stat-resource-audit.json -OutputDirectory .local/stat-assets
node scripts/build-stat-catalog.mjs .local/stat-resource-audit.json .local/stat-assets .local/cfpa
pwsh -File scripts/export-stat-icons.ps1
node scripts/build-stat-atlas.mjs
```

The last command retains its historical filename but now exports independent PNGs.
For uncached models it serves `http://127.0.0.1:1422/scripts/stat-icon-renderer.html`;
open that local page in a WebGL-capable browser. The page renders pending models,
posts PNG results locally, and the generator closes its server after publishing
the catalog. Cached images live under `.local/stat-rendered`. Rebuild desktop
executables only after generation has finished.

Check out only the matching `projects/assets/*/*/*/lang/{zh_cn,en_us}.{json,lang}`
files from the pinned CFPA revision. The GTCEu source checkout lives in
`.local/gtceu`. `stat-name-fallbacks.json` and the small supplemental template
tables are applied only after local and upstream lookup fails. Inspect
`.local/stat-name-missing.json` and `.local/stat-atlas-report.json` after generation.

On Windows, run Cargo verification and executable builds with one build job to
limit peak committed memory. Parallel all-target checks can report misleading
crate-version or missing-crate errors after a metadata memory mapping fails, even
with a fresh target directory. An isolated check can use:

```powershell
cargo clippy --manifest-path src-tauri/Cargo.toml --target-dir .local/cargo-verify-0105 --offline --all-targets --jobs 1 -- -D warnings
```

`--offline` requires the dependencies to be cached already. Set
`$env:CARGO_BUILD_JOBS = '1'` before the desktop build/package scripts to use the
same limit. A frontend build alone does not update the desktop executable.

## Attribution

CFPA translations are by the CFPA contributors and distributed under
CC BY-NC-SA 4.0. GTCEu resource translations are from GregTech-Modern, LGPL-3.0.
The applicable licenses accompany the resources in `public/resource-licenses/`.
Generated catalogs adapt and combine these resources with local pack translations;
the application's MIT license does not replace third-party resource licenses.
Minecraft assets belong to Mojang/Microsoft; mod and resource-pack artwork remains
the property of its respective authors. The per-entry source fields preserve
archive names and resource paths. Supplemental translations are MineChronicle's.

## Verification

### 0.10.6 resource adapters

Interaction aliases now distinguish item and entity resources: talking/trading
uses the villager model; armor/banner/shulker cleaning, sleeping, Forbidden
Arcanus's pedestal and the Bumblezone's two interactions use their matching
inventory resources. `stat-legacy-resources.json` maps the observed 1.7.10 vanilla
numeric IDs to resources while preserving the original statistic keys and values.
Metadata-free legacy block IDs use a representative base variant; unknown mod
numeric IDs are not guessed. Legacy icons use the selected instance's old
`textures/items` and `textures/blocks` assets, with original foliage tint.
Villagers combine the complete base skin and plains clothing; a profession
overlay alone is never used as the full skin.

`stat-icons-special.ps1` adds the original ShulkerModel lid/base, BedRenderer
head/foot and BannerRenderer geometry and UVs. The banner pole retains its wood
texture while the cloth uses the matching dye tint. Vanilla geometry was checked
against the Mojang sources mirrored at `mahtomedi/minecraft` in
`net/minecraft/client/{model/ShulkerModel,renderer/blockentity/BedRenderer,renderer/blockentity/BannerRenderer}.java`.
Ad Astra tiers 1–4 and Ad Astra Rocketed tiers 5–7 read their installed
`createTierNLayer` methods and original rocket textures. SlashBlade Resharped
reads its singular `assets/slashblade/model` directory and renders exactly the
`item_blade` OBJ group selected by SlashBladeTEISR; other attack/broken/world
groups are excluded. OBJ UVs repeat outside 0–1 as they do in Minecraft.
The cyan decoration in the supplied blade model/texture is retained. Existing
item texture priority is preserved. Minecraft
26.2 beds use their new translated composite JSON models, and banners use their
renamed base texture. Composite transforms copy coordinate arrays so exporting
one color cannot move a cached parent or a previously exported color.

Alex's Mobs now binds the default capuchin skin, small catfish model/skin and blue
comb jelly with its original overlay (0.05 inflation), as specified by the
installed Render classes. The seven reported Age of Mythology entities use their
actual shared `abstract_boss.geo.json` and individual textures; Good Evil uses
phase 1 and Shadow Demon uses its supplied default skin. Statistics do not retain
mob variant/NBT/phase or an individual blade's custom NBT, so these are stable
representatives. No Minecraft classes are executed: geometry is interpreted
offline, then published as 256×256 PNGs. Runtime has no added model rendering,
network requests or background asset scans.

Models with explicit Blockbench `#missing` face markers retain valid faces and
their original UVs instead of losing the entire icon. Missing actual textures
still fail extraction. `merge-stat-icon-manifests.mjs` validates identities and
SHA256 texture bytes before merging targeted exports into the resource manifest.

The final 0.10.6 catalog adds icon coverage to 159 category/key rows. All 482
targeted statistic/root combinations resolve to published images. There are
10,472 distinct images, including 104 new images compared with 0.10.5. The final
independent audit checked those 104 outputs, 183 source frames and 528,640 pixels
with no failures, including minimum visible-area checks for villagers and beds.
Forty published samples were visually reviewed. The 13 relevant Rust resource
and category tests passed; the four coverage tests were rerun after the final
model fixes. The PowerShell regression checks cover shared-parent isolation,
two adjacent bed parts, explicit missing faces and rejected unsupported
transforms. TypeScript, ESLint and formatting checks passed.

On September 8, 2026, the 0.10.6 release package and embedded debug executable
were rebuilt with one Cargo job. The NSIS package was installed at
`D:/MineChronicleApp`; both that executable and
`src-tauri/target/debug/minechronicle.exe` reported frontend/backend 0.10.6,
embedded assets, `http://tauri.localhost/` and the D-drive archive. Release,
installed and debug executables all use the x64 Windows GUI subsystem.
The installed binary is byte-identical to the release binary apart from the
three-byte Tauri NSIS bundle marker (`UNK` → `NSS`). The installer SHA256 is
recorded beside the package in `SHA256SUMS.txt`.

Actual Windows UI checks at the existing 125% zoom confirmed shulker-box,
bed and complete villager icons in the installed interaction list, including
the villager's 256×256 preview and original base/clothing source attribution.
The debug executable also displayed the complete bed in its statistics row
and 256×256 preview. The existing player combination was preserved; only
category/search filters were used, and the temporary search was cleared.
Before and after installation and both launches, the archive retained 63
instances, 97 worlds, 53 players, 410 snapshots and scan revision 234, with
unchanged initial/current tick totals and passing SQLite integrity and
foreign-key checks. Build logs and startup receipts are retained in `.local/`.

Contract coverage checks complete labels, safe image filenames, PNG header dimensions,
native 16-pixel and non-square originals, 256-pixel model images, material-name
examples, Chinese search, non-summed version metadata and
legacy/modern units, modern block item/chest assets, sorting across page boundaries,
special models, interaction mappings, stable ties and metadata placement.
Frontend tests cover large integers and exact seconds. Visual QA includes actual
Windows UI checks, high-DPI browser captures and nontransparent image-pixel checks.

Version 0.10.5 was packaged and installed at `D:/MineChronicleApp`, and the embedded
debug executable at `src-tauri/target/debug/minechronicle.exe` was rebuilt. Both
reported matching frontend/backend 0.10.5 and loaded `http://tauri.localhost/`.
Actual Windows checks confirmed independent ranking expansion to 10 and 15 rows,
Ad Astra entity icons and a 256-pixel model preview, Draconic modules and GregTech
bronze resources. Frontend's 63 tests and all 115 Rust tests passed across the
completed runs; the new resource contracts were rerun after the 26.1 texture-path
fix. TypeScript, ESLint, formatting and single-job Clippy checks passed.

Independent validation checked 10,379 PNGs and 13,300,572 pixels, including 5,067
byte-identical originals. The final resource mapping audit passed all 55
representative keys; the 26.1 additions reused existing images. Before and after
desktop startup, the archive retained 63 instances, 97 worlds, 53 players, 410
snapshots and scan revision 234, with unchanged tick totals and passing SQLite
integrity/foreign-key checks. Release, installed and debug executables use the
x64 Windows GUI subsystem.
