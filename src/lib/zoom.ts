import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';

export const MIN_ZOOM = 75;
export const MAX_ZOOM = 175;
export const ZOOM_PRESETS = [75, 90, 100, 110, 125, 150, 175] as const;
const STORAGE_KEY = 'minechronicle.uiZoom';

export function normalizeZoom(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value)))
    : 100;
}

export function loadZoom(): number {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? normalizeZoom(JSON.parse(saved)) : 100;
  } catch {
    return 100;
  }
}

export function saveZoom(value: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(normalizeZoom(value)));
  } catch {
    // Display preferences must remain usable when storage is unavailable.
  }
}

let pending: Promise<void> = Promise.resolve();

export function applyZoom(value: number): Promise<void> {
  const scale = normalizeZoom(value) / 100;
  // Serialize WebView calls so rapid changes cannot finish out of order.
  const next = pending.then(async () => {
    const root = document.documentElement;
    if (isTauri()) {
      await getCurrentWebview().setZoom(scale);
      root.dataset.zoomMode = 'webview';
      root.style.setProperty('--ui-css-zoom', '1');
    } else {
      root.style.zoom = String(scale);
      root.dataset.zoomMode = 'css';
      root.style.setProperty('--ui-css-zoom', String(scale));
    }
    window.dispatchEvent(new Event('minechronicle:zoom-change'));
  });
  pending = next.catch(() => undefined);
  return next;
}
