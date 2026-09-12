import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { checkRuntime } from './runtime';

beforeEach(() => {
  vi.stubGlobal('window', {});
  vi.stubGlobal('isTauri', false);
});
afterEach(() => {
  clearMocks();
  vi.unstubAllGlobals();
});

describe('desktop runtime boundary', () => {
  it('returns preview mode outside Tauri', async () => {
    expect(await checkRuntime()).toBeNull();
  });
  it('calls the real command name when hosted by Tauri', async () => {
    vi.stubGlobal('isTauri', true);
    mockWindows('main');
    mockIPC((command) => {
      expect(command).toBe('phase_status');
      return { phase: 4, offline: true, scanning_available: true };
    });
    expect(await checkRuntime()).toEqual({
      phase: 4,
      offline: true,
      scanning_available: true,
    });
  });
  it('propagates backend failure instead of displaying a successful check', async () => {
    vi.stubGlobal('isTauri', true);
    mockIPC(() => {
      throw new Error('Bridge unavailable');
    });
    await expect(checkRuntime()).rejects.toThrow('Bridge unavailable');
  });
});
