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
type RenderJob = {
  kind?: string;
  layers?: string[];
  frameHeight?: number;
  cacheKey?: string;
  root?: string;
  entityModel?: unknown;
  elements?: unknown;
  textures?: unknown;
  display?: unknown;
};
let renderQueue = Promise.resolve();
async function cropFirstFrame(dataUrl: string, frameHeight: number) {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const height = Math.max(1, Math.min(frameHeight, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, image.naturalWidth, height, 0, 0, canvas.width, canvas.height);
  return {
    image: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
    kind: 'item',
  };
}
async function persistRenderedIcon(
  job: RenderJob,
  rendered: { image: string; width: number; height: number; kind?: string },
) {
  if (!job.cacheKey) return;
  try {
    await invoke('store_stat_icon', {
      request: {
        cache_key: job.cacheKey,
        png: rendered.image,
        width: rendered.width,
        height: rendered.height,
        kind: rendered.kind ?? 'model',
        source: job.root ?? '',
        reason: '本地渲染并缓存',
      },
    });
  } catch {
    // Cache write is best-effort; the rendered icon still displays.
  }
}
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
        const job = entry.job as RenderJob;
        try {
          if (job.kind === 'frame' && job.layers?.[0] && job.frameHeight) {
            Object.assign(entry, await cropFirstFrame(job.layers[0], job.frameHeight));
          } else {
            const { renderRuntime } = await import(
              '../../scripts/stat-icon-renderer.mjs'
            );
            Object.assign(entry, await renderRuntime(job));
          }
          if (entry.image && entry.width && entry.height) {
            await persistRenderedIcon(job, {
              image: entry.image,
              width: entry.width,
              height: entry.height,
              kind: entry.kind,
            });
          }
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
