import { invoke, isTauri } from '@tauri-apps/api/core';
import type { StatisticsPage } from './activity';
declare const __STAT_ICON_EXTENSION__: string | undefined;
declare const __STAT_ICON_PNG_FILES__: string[] | undefined;
export interface Resolution {
  image: string | null;
  source: string;
  reason: string;
  job?: unknown;
  width?: number;
  height?: number;
  kind?: string;
}
export type DiscoverStatus =
  | 'cached'
  | 'resolved'
  | 'rendered'
  | 'missing'
  | 'error';
export interface DiscoverDetail {
  id: string;
  label: string;
  status: DiscoverStatus;
  source: string;
  reason: string;
}
export interface DiscoverResult {
  icons: Record<string, Resolution>;
  details: DiscoverDetail[];
  processedRows: number;
  cancelled: boolean;
  summary: {
    cached: number;
    resolved: number;
    rendered: number;
    missing: number;
    error: number;
  };
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
export interface DiscoverOptions {
  refreshKnown?: boolean;
  cacheOnly?: boolean;
  /** Requests per backend call; smaller chunks keep a big page responsive. */
  chunkSize?: number;
  /** Stops after the active backend call or render finishes. */
  signal?: AbortSignal;
}
let renderQueue = Promise.resolve();
function classify(
  entry: Resolution,
  label: string,
  id: string,
  renderedIds: ReadonlySet<string>,
): DiscoverDetail {
  const hasImage = Boolean(entry.image);
  const fromCache = entry.reason === '本地缓存图标';
  let status: DiscoverStatus = 'missing';
  if (hasImage) {
    if (fromCache) status = 'cached';
    else if (renderedIds.has(id)) status = 'rendered';
    else status = 'resolved';
  } else if (
    entry.reason === '检查已取消' ||
    entry.reason.includes('失败') ||
    entry.reason.includes('错误') ||
    entry.reason.includes('渲染')
  )
    status = 'error';
  return {
    id,
    label,
    status,
    source: entry.source ?? '',
    reason: entry.reason ?? '',
  };
}
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
  context.drawImage(
    image,
    0,
    0,
    image.naturalWidth,
    height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
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
function summarize(details: DiscoverDetail[]) {
  const summary = {
    cached: 0,
    resolved: 0,
    rendered: 0,
    missing: 0,
    error: 0,
  };
  for (const detail of details) {
    if (detail.status === 'cached') summary.cached += 1;
    else if (detail.status === 'resolved') summary.resolved += 1;
    else if (detail.status === 'rendered') summary.rendered += 1;
    else if (detail.status === 'error') summary.error += 1;
    else summary.missing += 1;
  }
  return summary;
}
export async function discoverIcons(
  rows: StatisticsPage['rows'],
  options: DiscoverOptions = {},
): Promise<DiscoverResult> {
  const empty: DiscoverResult = {
    icons: {},
    details: [],
    processedRows: 0,
    cancelled: false,
    summary: {
      cached: 0,
      resolved: 0,
      rendered: 0,
      missing: 0,
      error: 0,
    },
  };
  if (!isTauri()) return empty;
  const refreshKnown = options.refreshKnown ?? false;
  const cacheOnly = options.cacheOnly ?? false;
  const pending = rows.filter(
    (r) =>
      r.key !== 'minecraft:air' &&
      (refreshKnown || !r.resources.some((resource) => resource.icon)),
  );
  if (!pending.length) return { ...empty, processedRows: rows.length };
  const noRootRows = pending.filter(
    (r) => !(r.resource_roots ?? []).length,
  ).length;
  // Send in chunks rather than one request per page: a full "check every row"
  // pass is 100 rows today, and the backend cap is a safety limit, not a budget
  // the UI must match exactly. Chunking also keeps a single oversized page from
  // failing outright, and lets each chunk's Java bytecode budget reset.
  const result: Record<string, Resolution> = {};
  const chunkSize = options.chunkSize ?? 40;
  let processedRows = rows.length - pending.length;
  for (let start = 0; start < pending.length; start += chunkSize) {
    if (options.signal?.aborted) break;
    const chunk = pending.slice(start, start + chunkSize);
    let part: Record<string, Resolution>;
    try {
      part = await invoke<Record<string, Resolution>>('resolve_stat_icons', {
        args: {
          requests: chunk.map((r) => ({
            key: r.key,
            category: r.category,
            roots: r.resource_roots ?? [],
          })),
          cacheOnly,
        },
      });
    } catch (error) {
      const reason =
        error instanceof Error ? error.message.slice(0, 240) : '未知错误';
      part = Object.fromEntries(
        chunk.map((row) => [
          `${row.category}:${row.key}`,
          {
            image: null,
            source: '',
            reason: `本地资源请求失败：${reason}`,
          },
        ]),
      );
    }
    Object.assign(result, part);
    processedRows += chunk.length;
  }
  if (noRootRows) {
    for (const entry of Object.values(result)) {
      if (!entry.image && !entry.job && entry.reason.includes('来源实例')) {
        entry.reason = `${entry.reason}（本页有 ${noRootRows} 行未绑定实例根目录）`;
      }
    }
  }
  const labels = new Map(
    pending.map((r) => [`${r.category}:${r.key}`, r.label ?? r.key]),
  );
  const renderedIds = new Set<string>();
  if (!cacheOnly) {
    const work = renderQueue.then(async () => {
      for (const [id, entry] of Object.entries(result))
        if (entry.job) {
          if (options.signal?.aborted) {
            entry.reason = '检查已取消';
            delete entry.job;
            continue;
          }
          const job = entry.job as RenderJob;
          try {
            if (job.kind === 'frame' && job.layers?.[0] && job.frameHeight) {
              Object.assign(
                entry,
                await cropFirstFrame(job.layers[0], job.frameHeight),
              );
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
              renderedIds.add(id);
            }
          } catch {
            entry.reason = '已找到模型，但本地渲染失败；保留已有图标';
          }
          delete entry.job;
          // Let the WebView paint between renders to avoid UI freeze/crash.
          await new Promise((r) => setTimeout(r, 0));
        }
    });
    renderQueue = work.catch(() => {});
    await work;
  }
  const details = Object.entries(result).map(([id, entry]) =>
    classify(entry, labels.get(id) ?? id, id, renderedIds),
  );
  return {
    icons: result,
    details,
    processedRows: Math.min(rows.length, processedRows),
    cancelled: options.signal?.aborted ?? false,
    summary: summarize(details),
  };
}
export function iconUrl(image: string) {
  return image.startsWith('data:image/png;base64,')
    ? image
    : `/stat-icons/${image.replace(
        /\.png$/i,
        `.${
          typeof __STAT_ICON_PNG_FILES__ !== 'undefined' &&
          __STAT_ICON_PNG_FILES__.includes(image)
            ? 'png'
            : typeof __STAT_ICON_EXTENSION__ === 'string'
            ? __STAT_ICON_EXTENSION__
            : 'png'
        }`,
      )}`;
}
