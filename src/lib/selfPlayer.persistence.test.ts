import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const backend = vi.hoisted(() => ({
  value: null as string | null,
  fail: false,
}));
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: async (command: string, args?: { identifier: string }) => {
    if (backend.fail) throw Error('database unavailable');
    if (command === 'self_player_identity') return backend.value;
    if (command === 'set_self_player_identity') {
      backend.value = args!.identifier;
      return;
    }
    throw Error(command);
  },
}));
beforeEach(() => {
  vi.resetModules();
  backend.value = null;
  backend.fail = false;
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('localStorage', {
    getItem: () => 'LegacyName',
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
});
afterEach(() => vi.unstubAllGlobals());
it('migrates legacy preference then reloads from SQLite without browser storage', async () => {
  let store = await import('./selfPlayer');
  await store.loadSelfPlayer();
  expect(backend.value).toBe('LegacyName');
  await store.saveSelfPlayer(' Jasonsomelike ');
  vi.resetModules();
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => {
      throw Error('blocked');
    },
  });
  store = await import('./selfPlayer');
  await store.loadSelfPlayer();
  expect(store.getSelfPlayerState()).toEqual({
    value: 'Jasonsomelike',
    loaded: true,
    error: '',
  });
});
it('does not resurrect a cleared identity from stale browser storage', async () => {
  backend.value = '';
  const store = await import('./selfPlayer');
  await store.loadSelfPlayer();
  expect(store.getSelfPlayerState().value).toBe('');
  expect(backend.value).toBe('');
});
it('reports read failures and keeps the last saved identity on write failure', async () => {
  backend.value = 'Steve';
  const store = await import('./selfPlayer');
  await store.loadSelfPlayer();
  backend.fail = true;
  await expect(store.saveSelfPlayer('Alex')).rejects.toThrow();
  expect(store.getSelfPlayerState().value).toBe('Steve');
  await expect(store.loadSelfPlayer()).rejects.toThrow();
  expect(store.getSelfPlayerState().loaded).toBe(false);
  expect(store.getSelfPlayerState().error).toContain('database unavailable');
});
