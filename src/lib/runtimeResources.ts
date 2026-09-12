import { invoke, isTauri } from '@tauri-apps/api/core';
import type { StatisticsPage } from './activity';
export interface Resolution {
  image: string | null;
  source: string;
  reason: string;
  job?: unknown;
  width?: number;
  height?: number;
  kind?: string;
}
let renderQueue = Promise.resolve();
export async function discoverIcons(
  rows: StatisticsPage['rows'],
  refreshKnown = false,
) {
  if (!isTauri()) return {};
  const pending = rows.filter(
    (r) =>
      r.key !== 'minecraft:air' &&
      (refreshKnown || !r.resources.some((resource) => resource.icon)),
  );
  if (!pending.length) return {};
  const result = await invoke<Record<string, Resolution>>(
    'resolve_stat_icons',
    {
      requests: pending.map((r) => ({
        key: r.key,
        category: r.category,
        roots: r.resource_roots ?? [],
      })),
    },
  );
  // One lazily-loaded WebGL context, serial work, no animation loop.
  const work = renderQueue.then(async () => {
    for (const entry of Object.values(result))
      if (entry.job) {
        try {
          const { renderRuntime } = await import(
            '../../scripts/stat-icon-renderer.mjs'
          );
          Object.assign(entry, await renderRuntime(entry.job));
        } catch {
          entry.reason = '已找到模型，但本地渲染失败；保留已有图标';
        }
        delete entry.job;
      }
  });
  renderQueue = work.catch(() => {});
  await work;
  return result;
}
export function iconUrl(image: string) {
  return image.startsWith('data:image/png;base64,')
    ? image
    : `/stat-icons/${image}`;
}
