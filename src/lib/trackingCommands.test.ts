import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { clearSessionEnd, loadSessionBounds, setSessionEnd } from './tracking';

/**
 * Wire-level argument names.
 *
 * Tauri maps a JavaScript camelCase key onto the Rust parameter's snake_case and
 * only in that direction: it resolves each parameter with a direct
 * `payload.get(key)` on the JSON body. Sending `ended_at` therefore fails with
 * "missing required key endedAt", which is exactly what shipped once - the
 * dialog could never save, and the browser check missed it because the mock
 * fixture accepted the wrong key. These assertions are the missing guard.
 */
beforeEach(() => {
  vi.stubGlobal('window', {});
  vi.stubGlobal('isTauri', true);
  mockWindows('main');
});
afterEach(() => {
  clearMocks();
  vi.unstubAllGlobals();
});

describe('observation edit commands', () => {
  it('sends the end time under the camelCase key Tauri expects', async () => {
    const calls: { command: string; payload: unknown }[] = [];
    mockIPC((command, payload) => {
      calls.push({ command, payload });
      return null;
    });

    await setSessionEnd(7, '2026-09-18T14:22:20Z');

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('set_observed_session_end');
    const payload = calls[0].payload as Record<string, unknown>;
    expect(payload).toEqual({ id: 7, endedAt: '2026-09-18T14:22:20Z' });
    // Stated separately so the failure names the mistake rather than showing a
    // diff: snake_case is not the wire name.
    expect(payload).not.toHaveProperty('ended_at');
  });

  it('sends the numeric id unchanged', async () => {
    const calls: { payload: unknown }[] = [];
    mockIPC((_command, payload) => {
      calls.push({ payload });
      return null;
    });
    await setSessionEnd(1234, '2026-09-18T14:22:20Z');
    expect((calls[0].payload as Record<string, unknown>).id).toBe(1234);
  });

  it('undoes with the id alone', async () => {
    const calls: { command: string; payload: unknown }[] = [];
    mockIPC((command, payload) => {
      calls.push({ command, payload });
      return null;
    });
    await clearSessionEnd(9);
    expect(calls[0].command).toBe('clear_observed_session_end');
    expect(calls[0].payload).toEqual({ id: 9 });
  });

  it('reads bounds with the id alone', async () => {
    const calls: { command: string; payload: unknown }[] = [];
    mockIPC((command, payload) => {
      calls.push({ command, payload });
      return { started_at: 'a', max_ended_at: null, status: 'interrupted' };
    });
    await loadSessionBounds(3);
    expect(calls[0].command).toBe('observed_session_bounds');
    expect(calls[0].payload).toEqual({ id: 3 });
  });
});
