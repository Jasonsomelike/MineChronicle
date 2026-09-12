import fs from 'node:fs';
const read = (p) =>
  JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const before = read('.local/coverage-before-0107.json');
const after = read('.local/coverage-after-0107.json');
const diagnostics = read('.local/items-diagnostics-0107.json');
const itemModels = new Map(diagnostics.map((r) => [r.key, r.models ?? []]));
const remaining = after.resources.map((row) => {
  let reason;
  if (
    [
      'minecraft:air',
      'minecraft:cave_air',
      'minecraft:void_air',
      'minecraft:barrier',
      'minecraft:light',
      'minecraft:structure_void',
    ].includes(row.key)
  )
    reason = '无可见游戏材质或不可见的技术方块';
  else if (row.key === 'cobblemon:pokemon')
    reason = '统计仅保留通用 Pokémon ID，无法确定实际物种模型';
  else if (row.entity)
    reason = '尚未完整支持该版本的模型绑定、动画/分体或自定义渲染器';
  else {
    const models = itemModels.get(row.key) ?? [];
    const loaders = [
      ...new Set(models.map((r) => r.definition?.loader).filter(Boolean)),
    ];
    const parents = [
      ...new Set(models.map((r) => r.definition?.parent).filter(Boolean)),
    ];
    reason = loaders.length
      ? `自定义模型加载器：${loaders.join('、')}`
      : parents.some((p) => p.includes('builtin/entity'))
      ? '方块实体或物品自定义渲染器'
      : !models.length
      ? '未找到同名物品模型；需进一步解析运行时注册或确认源包是否可用'
      : '已有模型定义，仍需处理特殊父模型、材质或版本差异';
  }
  return { ...row, reason };
});
const reasons = {};
for (const row of remaining)
  reasons[row.reason] = (reasons[row.reason] ?? 0) + 1;
const result = {
  before: {
    requests: before.requests,
    resolved: before.resolved,
    missing: before.missing,
    distinctMissing: before.distinctMissing,
  },
  after: {
    requests: after.requests,
    resolved: after.resolved,
    missing: after.missing,
    distinctMissing: after.distinctMissing,
  },
  additionalResolvedRequests: after.resolved - before.resolved,
  fewerDistinctMissing: before.distinctMissing - after.distinctMissing,
  reasons,
  remaining,
};
fs.writeFileSync(
  '.local/coverage-classified-0107.json',
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ ...result, remaining: undefined }, null, 2));
