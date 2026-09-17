import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { discoverIcons } from './runtimeResources';
import type { StatisticsPage } from './activity';

type Row = StatisticsPage['rows'][number];

/** A row that needs icon resolution: non-air, no bundled icon. */
function row(index: number, withRoot = true): Row {
  return {
    category: 'minecraft:mined',
    key: `test:block_${index}`,
    category_label: '挖掘方块',
    label: `方块 ${index}`,
    unit: 'blocks',
    source_packs: ['Pack'],
    resource_roots: withRoot ? ['D:\\QA\\instance'] : [],
    resources: [],
    value: '1',
    sources: 1,
    samples: [],
  };
}

beforeEach(() => {
  // mockWindows/mockIPC install onto window.__TAURI_INTERNALS__, so the global
  // must exist first (same order as runtime.test.ts).
  vi.stubGlobal('window', {});
  vi.stubGlobal('isTauri', true);
  mockWindows('main');
});
afterEach(() => {
  clearMocks();
  vi.unstubAllGlobals();
});

describe('discoverIcons request chunking', () => {
  it('splits a large page into several backend calls', async () => {
    const calls: number[] = [];
    mockIPC((command, payload) => {
      expect(command).toBe('resolve_stat_icons');
      const requests = (payload as { args: { requests: { key: string }[] } })
        .args.requests;
      calls.push(requests.length);
      // Echo one resolution per requested key.
      return Object.fromEntries(
        requests.map((r) => [
          r.key,
          { image: null, source: '', reason: '未找到', job: null },
        ]),
      );
    });

    const rows = Array.from({ length: 100 }, (_, i) => row(i));
    const result = await discoverIcons(rows, { refreshKnown: true });

    expect(calls.length).toBeGreaterThan(1);
    expect(calls.reduce((sum, n) => sum + n, 0)).toBe(100);
    // Every key must come back, none dropped by the chunk boundary.
    expect(Object.keys(result.icons)).toHaveLength(100);
    expect(result.details).toHaveLength(100);
  });

  it('honours an explicit chunk size', async () => {
    const calls: number[] = [];
    mockIPC((_command, payload) => {
      const requests = (payload as { args: { requests: { key: string }[] } })
        .args.requests;
      calls.push(requests.length);
      return Object.fromEntries(
        requests.map((r) => [
          r.key,
          { image: null, source: '', reason: '未找到', job: null },
        ]),
      );
    });
    await discoverIcons(
      Array.from({ length: 25 }, (_, i) => row(i)),
      { refreshKnown: true, chunkSize: 10 },
    );
    expect(calls).toEqual([10, 10, 5]);
  });

  it('keeps every row when the page size is not a multiple of the chunk size', async () => {
    mockIPC((_command, payload) => {
      const requests = (payload as { args: { requests: { key: string }[] } })
        .args.requests;
      return Object.fromEntries(
        requests.map((r) => [
          r.key,
          { image: null, source: '', reason: '未找到', job: null },
        ]),
      );
    });
    // 7 rows with chunkSize 3 => 3 + 3 + 1; the tail must not be dropped.
    const result = await discoverIcons(
      Array.from({ length: 7 }, (_, i) => row(i)),
      { refreshKnown: true, chunkSize: 3 },
    );
    expect(result.details).toHaveLength(7);
    expect(result.summary.missing).toBe(7);
  });

  it('aggregates summary counts across chunks', async () => {
    let call = 0;
    mockIPC((_command, payload) => {
      const requests = (payload as { args: { requests: { key: string }[] } })
        .args.requests;
      call += 1;
      // First chunk resolves, later chunks miss.
      return Object.fromEntries(
        requests.map((r) =>
          call === 1
            ? [
                r.key,
                {
                  image: 'icon.png',
                  source: 'pack.jar',
                  reason: '自动发现本地原始材质',
                  job: null,
                },
              ]
            : [r.key, { image: null, source: '', reason: '未找到', job: null }],
        ),
      );
    });
    const result = await discoverIcons(
      Array.from({ length: 6 }, (_, i) => row(i)),
      { refreshKnown: true, chunkSize: 3 },
    );
    expect(result.details).toHaveLength(6);
    expect(result.summary.resolved).toBe(3);
    expect(result.summary.missing).toBe(3);
  });

  it('makes no backend call when every row is already resolved', async () => {
    let called = 0;
    mockIPC(() => {
      called += 1;
      return {};
    });
    const resolved: Row = {
      ...row(0),
      resources: [
        {
          packs: ['Pack'],
          label: '石头',
          english: 'Stone',
          origin: 'local',
          translation_source: null,
          icon: {
            image: 'abc.png',
            size: 16,
            kind: 'item',
            source: 'pack.jar',
          },
        },
      ],
    };
    const result = await discoverIcons([resolved]);
    expect(called).toBe(0);
    expect(result.details).toHaveLength(0);
  });
});
