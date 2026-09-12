import { useEffect, useSyncExternalStore } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';

const key = 'minechronicle.self-player';
const event = 'minechronicle:self-player-change';
let snapshot = { value: '', loaded: false, error: '' };
let pending: Promise<void> | null = null;
export const getSelfPlayerState = () => snapshot;
function publish(value: string, error = '') {
  snapshot = { value, loaded: true, error };
  window.dispatchEvent(new Event(event));
}
export function loadSelfPlayer(): Promise<void> {
  if (pending) return pending;
  pending = (async () => {
    try {
      const saved = isTauri()
        ? await invoke<string | null>('self_player_identity')
        : readSelfPlayer();
      const value = saved ?? readSelfPlayer();
      if (isTauri() && saved === null && value)
        await invoke('set_self_player_identity', { identifier: value });
      publish(value);
    } catch (error) {
      snapshot = {
        ...snapshot,
        loaded: false,
        error: `自己配置读取失败：${String(error)}`,
      };
      window.dispatchEvent(new Event(event));
      throw error;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

export function normalizePlayerUuid(value: string): string | null {
  const text = value.trim();
  if (
    !/^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.test(
      text,
    )
  )
    return null;
  const hex = text.replaceAll('-', '').toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function resolveSelfPlayer(
  identifier: string,
  players: [string, string][],
) {
  const text = identifier.trim();
  const uuid = normalizePlayerUuid(text);
  const matches = text
    ? players.filter(([id, name]) =>
        uuid
          ? normalizePlayerUuid(id) === uuid
          : name.toLowerCase() === text.toLowerCase(),
      )
    : [];
  return matches;
}

export function readSelfPlayer() {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

export async function saveSelfPlayer(identifier: string) {
  const value = normalizePlayerUuid(identifier) ?? identifier.trim();
  if (isTauri())
    await invoke('set_self_player_identity', { identifier: value });
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* SQLite is authoritative in the desktop app. */
  }
  publish(value);
}

function subscribe(listener: () => void) {
  window.addEventListener(event, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(event, listener);
    window.removeEventListener('storage', listener);
  };
}

export function useSelfPlayer() {
  return useSelfPlayerState().value;
}
export function useSelfPlayerState() {
  const state = useSyncExternalStore(
    subscribe,
    getSelfPlayerState,
    getSelfPlayerState,
  );
  useEffect(() => {
    if (!snapshot.loaded) void loadSelfPlayer().catch(() => {});
  }, []);
  return state;
}
