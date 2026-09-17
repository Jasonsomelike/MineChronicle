import fs from 'node:fs';

const read = (file) =>
  JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const requests = read('.local/stat-icon-requests.json');
const lookup = read('.local/stat-icon-lookup.json');
const catalog = read('src-tauri/resources/stat-resources.json');
const missing = [],
  resolved = [],
  unavailable = new Map();
for (const request of requests) {
  const identity = `${request.root}|${request.entity ? 'entity:' : ''}${
    request.key
  }`;
  const icon = lookup[identity];
  const row = catalog[request.id];
  const valid =
    icon &&
    row?.some((v) => v.icon?.image === icon.image) &&
    fs.existsSync(`public/stat-icons/${icon.image}`);
  if (valid) {
    resolved.push(request);
    continue;
  }
  missing.push(request);
  const key = `${request.entity ? 'entity:' : 'item:'}${request.key}`;
  const record = unavailable.get(key) ?? {
    key: request.key,
    entity: !!request.entity,
    roots: [],
    categories: [],
  };
  if (!record.roots.includes(request.root)) record.roots.push(request.root);
  if (!record.categories.includes(request.category))
    record.categories.push(request.category);
  unavailable.set(key, record);
}
const namespaces = {};
for (const entry of unavailable.values()) {
  const ns = `${entry.entity ? 'entity' : 'item'}:${entry.key.split(':')[0]}`;
  namespaces[ns] = (namespaces[ns] ?? 0) + 1;
}
const report = {
  requests: requests.length,
  resolved: resolved.length,
  missing: missing.length,
  distinctMissing: unavailable.size,
  namespaces: Object.fromEntries(
    Object.entries(namespaces).sort((a, b) => b[1] - a[1]),
  ),
  resources: [...unavailable.values()].sort((a, b) =>
    a.key.localeCompare(b.key),
  ),
};
fs.mkdirSync('.local', { recursive: true });
const output = process.argv[2] ?? '.local/stat-coverage-audit.json';
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(
  output.replace(/\.json$/, '-requests.json'),
  JSON.stringify(missing),
);
console.log(JSON.stringify({ ...report, resources: undefined }, null, 2));
