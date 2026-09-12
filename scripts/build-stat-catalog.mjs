import fs from 'node:fs';
import path from 'node:path';

const read = (p) =>
  JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const audit = read(process.argv[2] ?? '.local/stat-resource-audit.json');
const assetDirectory = process.argv[3] ?? '.local/stat-assets';
const cfpaDirectory = process.argv[4] ?? '.local/cfpa';
const base = read('src-tauri/resources/stat-translations.json');
const iconAliases = read('scripts/stat-icon-aliases.json');
const legacyResources = read('scripts/stat-legacy-resources.json');
const reviewed = fs.existsSync('scripts/stat-name-fallbacks.json')
  ? read('scripts/stat-name-fallbacks.json')
  : {};
const upstream = new Map();
const chinese = (s) =>
  /[\u3400-\u9fff]/.test(s ?? '') || s === 'TNT' || s === '%s';
const clean = (s) => s.replace(/\u00a7[0-9a-fk-or]/gi, '').trim();
function language(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  if (file.endsWith('.json')) {
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((l) => !/^\s*#/.test(l) && l.includes('='))
      .map((l) => [
        l.slice(0, l.indexOf('=')).trim(),
        l.slice(l.indexOf('=') + 1).trim(),
      ]),
  );
}
for (const file of fs.readdirSync(path.join(cfpaDirectory, 'projects/assets'), {
  recursive: true,
})) {
  const m = file
    .replaceAll('\\', '/')
    .match(/^([^/]+)\/([^/]+)\/([^/]+)\/lang\/(zh_cn|en_us)\.(json|lang)$/);
  if (!m) continue;
  const [, project, version, namespace, locale] = m;
  const id = `${namespace}|${version}|${locale}`;
  const lang = upstream.get(id) ?? {};
  for (const [k, v] of Object.entries(
    language(path.join(cfpaDirectory, 'projects/assets', file)),
  ))
    if (typeof v === 'string')
      lang[k] = [
        v,
        `CFPA / ${project} / ${version} / ${namespace}/lang/${locale}.${m[5]}`,
      ];
  upstream.set(id, lang);
}
const gtPath = '.local/gtceu/src/main/resources/assets/gtceu/lang/zh_cn.json';
const gt = fs.existsSync(gtPath)
  ? Object.fromEntries(
      Object.entries(read(gtPath)).map(([k, v]) => [
        k,
        [v, 'GregTechCEu/GregTech-Modern / 1.20.1 / zh_cn.json'],
      ]),
    )
  : {};
function upstreamFor(namespace, version, locale) {
  const [major, minor] = (version ?? '1.20').split('.').map(Number);
  const candidates = [...upstream.keys()]
    .filter((k) => k.startsWith(namespace + '|') && k.endsWith('|' + locale))
    .filter((k) => {
      const v = k.split('|')[1];
      const [a, b] = v.split('.').map(Number);
      return a === major && b <= minor && !v.includes('fabric');
    })
    .sort((a, b) =>
      b
        .split('|')[1]
        .localeCompare(a.split('|')[1], undefined, { numeric: true }),
    );
  return candidates.length ? upstream.get(candidates[0]) : {};
}
function resourceKey(category, key) {
  if (category === 'legacy')
    for (const [prefix, c] of [
      ['stat.mineBlock.', 'minecraft:mined'],
      ['stat.craftItem.', 'minecraft:crafted'],
      ['stat.useItem.', 'minecraft:used'],
      ['stat.breakItem.', 'minecraft:broken'],
      ['stat.pickup.', 'minecraft:picked_up'],
      ['stat.drop.', 'minecraft:dropped'],
      ['stat.killEntity.', 'minecraft:killed'],
      ['stat.entityKilledBy.', 'minecraft:killed_by'],
    ])
      if (key.startsWith(prefix)) {
        const name = key.slice(prefix.length);
        const item = ['minecraft:killed', 'minecraft:killed_by'].includes(c)
          ? null
          : legacyResources[name];
        return [c, item?.key ?? name.replace('.', ':')];
      }
  return [category, key];
}
function entityKey(key) {
  if (key.includes(':')) return key;
  const legacy = {
    CaveSpider: 'cave_spider',
    LavaSlime: 'magma_cube',
    PigZombie: 'zombified_piglin',
    VillagerGolem: 'iron_golem',
    SnowMan: 'snow_golem',
    Ozelot: 'ocelot',
    MushroomCow: 'mooshroom',
    EntityHorse: 'horse',
    WitherBoss: 'wither',
    EnderDragon: 'ender_dragon',
    WitherSkeleton: 'wither_skeleton',
  };
  return `minecraft:${
    legacy[key] ?? key.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
  }`;
}
function candidates(category, key) {
  const id = key.replaceAll(':', '.');
  const [ns, name] = key.split(':');
  const prefixes =
    category === 'minecraft:custom'
      ? ['stat']
      : ['minecraft:killed', 'minecraft:killed_by'].includes(category)
      ? ['entity']
      : category === 'minecraft:mined'
      ? ['block', 'item']
      : ['item', 'block', 'entity', 'stat'];
  return [
    key,
    ...prefixes.flatMap((p) => [
      `${p}.${id}`,
      `${p}.${id}.name`,
      `${ns}.${p}.${name}`,
      `${ns}.${p}.${name}.name`,
    ]),
    `tile.${id}.name`,
  ];
}
function resolve(category, key, lookup) {
  for (const id of candidates(category, key)) {
    const entry = lookup(id);
    if (entry && !/%(?:\d+\$)?[sd]/.test(entry[0])) return entry;
  }
  const [ns, name] = key.split(':');
  if (!name) return null;
  if (name.startsWith('glyph_')) {
    const glyph =
      lookup(`${ns}.glyph_name.${name}`) ??
      lookup(`ars_nouveau.glyph_name.${name}`);
    if (glyph) return [`符文：${glyph[0]}`, glyph[1]];
  }
  if (
    [
      'integrateddynamics',
      'integratedtunnels',
      'integratedcrafting',
      'integratedterminals',
    ].includes(ns) &&
    name.startsWith('part_')
  ) {
    const part = lookup(`parttype.${ns}.${name.slice(5)}`);
    if (part) return part;
  }
  if (ns === 'silentgear' && name.endsWith('_blueprint')) {
    const kind = name.replace(/_blueprint$/, ''),
      gear =
        lookup(`gearType.${ns}.${kind}`) ?? lookup(`partType.${ns}.${kind}`),
      template = lookup(`item.${ns}.blueprint`);
    if (gear && template)
      return [
        template[0].replace('%s', gear[0]),
        `${template[1]} · 蓝图名称模板`,
      ];
  }
  if (ns === 'ageofmythology' && name.endsWith('_item')) {
    const block = lookup(`block.${ns}.${name.replace(/_item$/, '_block')}`);
    if (block && !block[0].includes('translation{')) return block;
  }
  if (ns === 'herbsandharvest') {
    const value =
      lookup(`item.${ns}.${name}_item`) ??
      (name.endsWith('_seeds')
        ? lookup(`block.${ns}.${name.replace(/_seeds$/, '_crop')}`)
        : null);
    if (value) return value;
    if (name.endsWith('_seeds')) {
      const value = lookup(
        `tooltip.item.${ns}.${name.replace(/_seeds$/, '')}.seed_info`,
      );
      if (value && /^种子[：:]/.test(value[0]))
        return [value[0].replace(/^种子[：:]\s*/, ''), value[1]];
    }
    const guide = lookup(`guide.${ns}.${name}_desc`);
    if (guide && guide[0].length < 10) return guide;
  }
  if (ns === 'silentgems') {
    const match = name.match(
      /^(?:(end|nether|deepslate)_)?(.+?)(?:_(ore|glowrose|block|bricks))?$/,
    );
    if (match) {
      const gem = lookup(`gem.${ns}.${match[2]}`),
        type = match[3];
      const templateKey =
        type === 'ore'
          ? {
              end: 'gem_end_ore',
              nether: 'gem_nether_ore',
              deepslate: 'deepslate_gem_ore',
            }[match[1]] ?? 'gem_ore'
          : type === 'glowrose'
          ? 'glowrose'
          : `gem_${type}`;
      const template = lookup(`block.${ns}.${templateKey}`);
      if (gem && (!type || template))
        return type
          ? [
              template[0].replace(/%(?:1\$)?s/g, gem[0]),
              `${template[1]} · 宝石名称模板`,
            ]
          : gem;
    }
  }
  if (ns === 'mysticalagriculture') {
    const match = name.match(/^(.+)_(crop|seeds|essence)$/);
    if (match) {
      const material = lookup(`crop.${ns}.${match[1]}`),
        template = lookup(
          `${match[2] === 'crop' ? 'block' : 'item'}.${ns}.mystical_${
            match[2]
          }`,
        );
      if (material && template)
        return [
          template[0].replace(/%(?:1\$)?s/g, material[0]),
          `${template[1]} · 作物名称模板`,
        ];
    }
  }
  if (['gtceu', 'gtlcore', 'ctnhcore', 'gtmthings'].includes(ns)) {
    const pieces = name.split('_');
    for (let start = 0; start < pieces.length; start++)
      for (let end = pieces.length; end > start; end--) {
        const materialName = pieces.slice(start, end).join('_'),
          form = [...pieces.slice(0, start), ...pieces.slice(end)].join('_');
        const material =
          lookup(`material.${ns}.${materialName}`) ??
          lookup(`material.gtceu.${materialName}`) ??
          lookup(`material.ctnhcore.${materialName}`) ??
          lookup(`material.gtlcore.${materialName}`) ??
          lookup(`item.create.${materialName}`) ??
          lookup(`crop.mysticalagriculture.${materialName}`);
        const wire = form.match(
          /^(single|double|quadruple|octal|hex)_(wire|cable)$/,
        );
        const pipe = form.match(/^(.+)_(fluid|item)_pipe$/);
        const tag = wire
          ? `${wire[2]}_gt_${wire[1]}`
          : pipe
          ? `pipe_${pipe[1]}_${pipe[2]}`
          : form === 'ore'
          ? 'stone'
          : form.endsWith('_ore')
          ? form.slice(0, -4).replace('black_stone', 'blackstone')
          : form;
        const template =
          lookup(`tagprefix.${form}`) ??
          lookup(`tagprefix.${tag}`) ??
          (tag === 'raw_block' ? lookup('tagprefix.raw_ore_block') : null) ??
          lookup(`item.gtceu.tool.${form}`) ??
          (form === 'bucket' ? lookup('item.gtceu.bucket') : null);
        if (material && template)
          return [
            template[0].replace(/%(?:1\$)?s/g, material[0]),
            `${template[1]} · 材料名称模板`,
          ];
      }
  }
  return null;
}
function supplementalName(key, lookup) {
  const [ns, name] = key.split(':');
  if (!name) return null;
  if (ns === 'iceandfire') {
    const m = name.match(/^(dragonscales|dragonegg)_(.+)$/);
    const colors = {
      amythest: '紫水晶',
      black: '黑色',
      silver: '银色',
      copper: '铜色',
      bronze: '青铜色',
      green: '绿色',
      red: '红色',
      white: '白色',
      sapphire: '蓝宝石',
      blue: '蓝色',
      gray: '灰色',
    };
    if (m && colors[m[2]])
      return colors[m[2]] + (m[1] === 'dragonscales' ? '龙鳞' : '龙蛋');
    if (name === 'dragonarmor_diamond_body') return '钻石龙铠（躯干）';
  }
  if (ns === 'mysticalagriculture') {
    const m = name.match(/^(.+)_(crop|seeds|essence)$/);
    const materials = {
      entro: '熵变',
      awakened_draconium: '觉醒龙',
      darkstone: '暗石',
      nether_star: '下界之星',
      allthemodium: 'ATM',
      vibranium: '振金',
      nitro_crystal: '强化水晶（Nitro）',
      black_quartz: '黑石英',
      crimson_iron: '绯红铁',
      kivi: 'Kivi',
      sky_steel: '陨钢',
      xychorium_gem: '赛锆宝石',
    };
    if (m && materials[m[1]])
      return (
        materials[m[1]] + { crop: '作物', seeds: '种子', essence: '精华' }[m[2]]
      );
  }
  if (ns === 'gtceu' && name.endsWith('_indicator')) {
    const material = lookup(`material.gtceu.${name.slice(0, -10)}`);
    if (material) return `${material[0]}矿物指示石`;
  }
  if (ns === 'alexscaves' && name.startsWith('cave_painting_')) {
    const subject = name.slice(14);
    const subjects = {
      ambersol: '琥珀太阳',
      footprint: '足迹',
      grottoceratops: '洞穴角龙',
      grottoceratops_friend: '洞穴角龙伙伴',
      pewen: '南洋杉',
      relicheirus: '遗迹爪兽',
      relicheirus_slash: '遗迹爪兽斩击',
      tree_stars: '树星',
      tremorsaurus: '撼地暴龙',
      tremorsaurus_friend: '撼地暴龙伙伴',
    };
    if (subjects[subject]) return `洞穴壁画：${subjects[subject]}`;
  }
  return null;
}
const entries = {},
  missing = [],
  iconRequests = [],
  sources = new Set();
const counts = { local: 0, upstream: 0, bundled: 0, reviewed: 0, missing: 0 };
for (const root of audit.roots) {
  const file = path.join(assetDirectory, `${root.id}.json`);
  if (!fs.existsSync(file) || !fs.statSync(file).size) continue;
  const pack = read(file),
    records = audit.keys.filter((k) => k.roots.includes(root.id));
  const upstreamCache = new Map();
  function lookup(namespace, locale, key, origin) {
    const local = pack.lang[locale]?.[key];
    if (origin === 'local')
      return local && (locale !== 'zh_cn' || chinese(local[0])) ? local : null;
    if (origin === 'upstream') {
      const id = namespace + '|' + locale;
      if (!upstreamCache.has(id))
        upstreamCache.set(id, upstreamFor(namespace, pack.version, locale));
      const value =
        upstreamCache.get(id)[key] ??
        (['gtceu', 'gtlcore', 'ctnhcore', 'gtmthings'].includes(namespace) &&
        pack.version?.startsWith('1.20.')
          ? gt[key]
          : null);
      return value && (locale !== 'zh_cn' || chinese(value[0])) ? value : null;
    }
    return locale === 'zh_cn' && chinese(base[key])
      ? [base[key], '内置 Minecraft / 模组语言资源']
      : null;
  }
  for (const row of records) {
    const [category, key] = resourceKey(row.category, row.key),
      namespace = key.split(':')[0];
    let translated = null,
      origin = 'missing';
    for (const type of ['local', 'upstream', 'bundled']) {
      translated = resolve(category, key, (k) =>
        lookup(namespace, 'zh_cn', k, type),
      );
      if (translated) {
        origin = type;
        break;
      }
    }
    if (!translated) {
      translated = resolve(
        category,
        key,
        (k) =>
          lookup(namespace, 'zh_cn', k, 'local') ??
          lookup(namespace, 'zh_cn', k, 'upstream') ??
          lookup(namespace, 'zh_cn', k, 'bundled'),
      );
      if (translated) origin = 'upstream';
    }
    const english =
      resolve(
        category,
        key,
        (k) =>
          lookup(namespace, 'en_us', k, 'local') ??
          lookup(namespace, 'en_us', k, 'upstream'),
      )?.[0] ?? null;
    if (!translated) {
      const supplemental =
        reviewed[row.key] ??
        supplementalName(
          row.key,
          (k) =>
            lookup(namespace, 'zh_cn', k, 'local') ??
            lookup(namespace, 'zh_cn', k, 'upstream') ??
            lookup(namespace, 'zh_cn', k, 'bundled'),
        );
      if (supplemental) {
        translated = [supplemental, 'MineChronicle 补充翻译'];
        origin = 'reviewed';
      }
    }
    if (row.key === 'DataVersion') {
      translated = ['数据版本', 'Minecraft 存档格式'];
      origin = 'bundled';
    }
    const numeric =
      row.category === 'legacy' &&
      /^stat\.(?:mineBlock|craftItem|useItem|breakItem|pickup|drop)\.\d+$/.test(
        row.key,
      )
        ? legacyResources[row.key.slice(row.key.lastIndexOf('.') + 1)]
        : null;
    if (!translated && numeric) {
      translated = [numeric.label, 'Minecraft 1.7.10 原版数字 ID 对照'];
      origin = 'bundled';
    }
    const id = row.category + '|' + row.key;
    const info = {
      root: root.id,
      packs: pack.packs,
      label: translated ? clean(translated[0]) : null,
      english: english ? clean(english) : null,
      origin,
      translation_source: translated?.[1] ?? null,
    };
    (entries[id] ??= []).push(info);
    if (translated) sources.add(translated[1]);
    counts[origin]++;
    if (!translated)
      missing.push({
        id,
        key: row.key,
        category: row.category,
        root: root.id,
        packs: pack.packs,
        english,
      });
    if (category === 'minecraft:custom' && iconAliases[key]) {
      const alias = iconAliases[key];
      iconRequests.push({
        id,
        root: root.id,
        category,
        ...(typeof alias === 'string' ? { key: alias } : alias),
      });
    } else if (['minecraft:killed', 'minecraft:killed_by'].includes(category)) {
      iconRequests.push({
        id,
        root: root.id,
        key: entityKey(key),
        category,
        entity: true,
      });
    } else if (
      ![
        'minecraft:custom',
        'minecraft:killed',
        'minecraft:killed_by',
        'extra',
        'legacy',
      ].includes(category) &&
      key.includes(':')
    ) {
      iconRequests.push({ id, root: root.id, key, category });
    }
  }
  console.log(`Root ${root.id}: ${records.length} rows`);
}
fs.writeFileSync('.local/stat-catalog-draft.json', JSON.stringify(entries));
fs.writeFileSync(
  '.local/stat-name-missing.json',
  JSON.stringify(missing, null, 2),
);
fs.writeFileSync(
  '.local/stat-icon-requests.json',
  JSON.stringify(iconRequests),
);
fs.writeFileSync('.local/stat-catalog-counts.json', JSON.stringify(counts));
console.log(
  JSON.stringify({
    counts,
    uniqueMissing: new Set(missing.map((e) => e.id)).size,
    rows: Object.keys(entries).length,
  }),
);
