import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks';
import { Channel } from '@tauri-apps/api/core';
import {
  parseRootInput,
  scanGameRoots,
  cancelScan,
  loadLibrary,
  setPlayerAlias,
  runtimeInfo,
  discoverPclFolders,
} from './scan';
import type { ScanProgress } from './scan';

beforeEach(() => {
  vi.stubGlobal('window', { crypto: globalThis.crypto });
  vi.stubGlobal('isTauri', false);
});
afterEach(() => {
  clearMocks();
  vi.unstubAllGlobals();
});

describe('manual root input', () => {
  it('trims copied quoted paths and retains Windows separators and aliases', () => {
    expect(
      parseRootInput(
        ' "D:\\My Games\\.minecraft"\r\n\r\n D:\\Other\\..\\Root ',
      ),
    ).toEqual(['D:\\My Games\\.minecraft', 'D:\\Other\\..\\Root']);
  });
  it.each([
    '',
    ' \n ',
    '""',
    Array.from({ length: 33 }, () => 'D:\\root').join('\n'),
  ])('rejects empty or oversized requests', (input) => {
    expect(() => parseRootInput(input)).toThrow();
  });
});

describe('scan bridge', () => {
  it('rejects mismatched frontend and backend builds', async () => {
    vi.stubGlobal('isTauri', true);
    mockIPC(() => ({ version: '0.0.0' }));
    await expect(runtimeInfo()).rejects.toThrow('不一致');
  });
  it('loads PCL metadata and passes explicit launcher context when scanning', async () => {
    vi.stubGlobal('isTauri', true);
    mockIPC((command, payload) => {
      if (command === 'discover_pcl_folders')
        return { folders: [], launchers: [], issues: [] };
      expect(command).toBe('scan_pcl_roots');
      expect(payload).toMatchObject({
        paths: ['E:/External'],
        launcher: 'D:/PCL',
      });
      return { instances: [], roots: [] };
    });
    expect((await discoverPclFolders()).folders).toEqual([]);
    await scanGameRoots(['E:/External'], () => {}, 'D:/PCL');
  });
  it('loads persisted records and saves an explicit UUID alias through IPC', async () => {
    vi.stubGlobal('isTauri', true);
    const report = {
      roots: [],
      saved: true,
      historical_ticks: '18446744073709551614',
    };
    mockIPC((command, payload) => {
      if (command === 'load_library')
        return { report, inputs: ['D:\\Synthetic'] };
      expect(command).toBe('set_player_alias');
      expect(payload).toEqual({
        uuid: '00000000-0000-4000-8000-000000000001',
        name: 'SyntheticBuilder',
      });
      return report;
    });
    expect(await loadLibrary()).toEqual({ report, inputs: ['D:\\Synthetic'] });
    expect(
      await setPlayerAlias(
        '00000000-0000-4000-8000-000000000001',
        'SyntheticBuilder',
      ),
    ).toEqual(report);
  });
  it('does not load a local database in browser preview', async () => {
    mockIPC(() => {
      throw new Error('Must not call backend');
    });
    expect(await loadLibrary()).toBeNull();
  });
  it('does not attempt file access in a browser preview', async () => {
    await expect(scanGameRoots(['D:\\root'], () => {})).rejects.toThrow(
      '浏览器预览',
    );
  });
  it('passes paths and progress channel to Rust without rounding counters', async () => {
    vi.stubGlobal('isTauri', true);
    const progress = vi.fn();
    const result = {
      roots: [
        {
          path: 'D:\\root',
          requested_paths: ['D:\\root'],
          enumeration_complete: true,
          worlds: [
            {
              path: 'D:\\root\\saves\\world',
              name: 'World',
              status: 'Present',
              data_version: 3953,
              minecraft_version: '1.21',
              players: [
                {
                  uuid: 'synthetic',
                  play_ticks: '9223372036854775807',
                  source_paths: [],
                  conflicting: false,
                },
              ],
            },
          ],
        },
      ],
      issues: [],
      cancelled: false,
    };
    mockIPC((command, payload) => {
      expect(command).toBe('scan_game_roots');
      if (
        !payload ||
        Array.isArray(payload) ||
        payload instanceof ArrayBuffer ||
        ArrayBuffer.isView(payload)
      )
        throw new Error('Expected named IPC arguments');
      expect(payload.paths).toEqual(['D:\\root']);
      const channel = payload.onProgress;
      expect(channel).toBeInstanceOf(Channel);
      (channel as Channel<ScanProgress>).onmessage({
        roots_done: 1,
        roots_total: 1,
        worlds_scanned: 1,
        player_files_scanned: 1,
      });
      return result;
    });
    expect(await scanGameRoots(['D:\\root'], progress)).toEqual(result);
    expect(progress).toHaveBeenCalledWith({
      roots_done: 1,
      roots_total: 1,
      worlds_scanned: 1,
      player_files_scanned: 1,
    });
  });
  it('surfaces backend errors and sends the cancellation command', async () => {
    vi.stubGlobal('isTauri', true);
    mockIPC((command) => {
      if (command === 'scan_game_roots') throw new Error('busy');
      expect(command).toBe('cancel_scan');
    });
    await expect(scanGameRoots(['D:\\root'], () => {})).rejects.toThrow('busy');
    await expect(cancelScan()).resolves.toBeUndefined();
  });
});
