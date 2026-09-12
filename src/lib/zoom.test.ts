import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { applyZoom, loadZoom, normalizeZoom, saveZoom } from './zoom';

let storage: Map<string, string>;
let style: { zoom: string; setProperty: ReturnType<typeof vi.fn> };
let dataset: Record<string, string>;

beforeEach(() => {
  storage = new Map();
  style = { zoom: '', setProperty: vi.fn() };
  dataset = {};
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal('window', { dispatchEvent: vi.fn() });
  vi.stubGlobal('document', { documentElement: { style, dataset } });
  vi.stubGlobal('isTauri', false);
});

afterEach(() => {
  clearMocks();
  vi.unstubAllGlobals();
});

describe('zoom preferences', () => {
  it('defaults to 100% and persists a valid value', () => {
    expect(loadZoom()).toBe(100);
    saveZoom(125);
    expect(loadZoom()).toBe(125);
  });

  it('clamps finite numbers and rejects invalid stored values', () => {
    expect(normalizeZoom(15)).toBe(75);
    expect(normalizeZoom(999)).toBe(175);
    expect(normalizeZoom(110.4)).toBe(110);
    for (const invalid of ['null', '"125"', '{}', 'NaN', '']) {
      storage.set('minechronicle.uiZoom', invalid);
      expect(loadZoom()).toBe(100);
    }
    expect(normalizeZoom(Infinity)).toBe(100);
  });

  it('remains usable when preference storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('Storage disabled');
      },
      setItem: () => {
        throw new Error('Storage disabled');
      },
    });
    expect(loadZoom()).toBe(100);
    expect(() => saveZoom(150)).not.toThrow();
  });
});

describe('zoom runtime boundary', () => {
  it('uses layout zoom in browser preview and exposes its pixel scale', async () => {
    await applyZoom(150);
    expect(style.zoom).toBe('1.5');
    expect(dataset.zoomMode).toBe('css');
    expect(style.setProperty).toHaveBeenCalledWith('--ui-css-zoom', '1.5');
    expect(window.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'minechronicle:zoom-change' }),
    );
  });

  it('uses the native webview command without adding CSS scaling', async () => {
    vi.stubGlobal('isTauri', true);
    mockWindows('main');
    mockIPC((command, args) => {
      expect(command).toBe('plugin:webview|set_webview_zoom');
      expect(args).toEqual({ label: 'main', value: 1.25 });
    });
    await applyZoom(125);
    expect(style.zoom).toBe('');
    expect(dataset.zoomMode).toBe('webview');
    expect(style.setProperty).toHaveBeenCalledWith('--ui-css-zoom', '1');
  });

  it('reports native failure without applying a second scaling mechanism', async () => {
    vi.stubGlobal('isTauri', true);
    mockWindows('main');
    mockIPC(() => {
      throw new Error('Permission denied');
    });
    await expect(applyZoom(150)).rejects.toThrow('Permission denied');
    expect(style.zoom).toBe('');
    expect(style.setProperty).not.toHaveBeenCalled();
    expect(window.dispatchEvent).not.toHaveBeenCalled();
    mockIPC(() => undefined);
    await expect(applyZoom(100)).resolves.toBeUndefined();
  });

  it('serializes rapid changes so the last requested value wins', async () => {
    vi.stubGlobal('isTauri', true);
    mockWindows('main');
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const values: unknown[] = [];
    mockIPC((_command, args) => {
      values.push(args && 'value' in args ? args.value : undefined);
      return values.length === 1 ? gate : undefined;
    });
    const first = applyZoom(125);
    const second = applyZoom(175);
    await vi.waitFor(() => expect(values).toEqual([1.25]));
    release?.();
    await Promise.all([first, second]);
    expect(values).toEqual([1.25, 1.75]);
  });
});
