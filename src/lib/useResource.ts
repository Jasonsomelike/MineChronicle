import { useCallback, useEffect, useRef, useState } from 'react';

/** Keep successful data visible; ignore obsolete requests and pause retries while hidden. */
export function useResource<T>(
  load: () => Promise<T>,
  key: unknown,
  active = true,
  debounceMs = 0,
) {
  const loader = useRef(load);
  loader.current = load;
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{
    data?: T;
    error: string;
    loading: boolean;
    updatedAt: number;
  }>({ error: '', loading: true, updatedAt: 0 });
  const refresh = useCallback(() => setRetry((v) => v + 1), []);
  useEffect(() => {
    if (!active) return;
    let cancelled = false,
      running = false,
      failures = 0,
      needsRefresh = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      if (cancelled || running || document.hidden) return;
      clearTimeout(timer);
      running = true;
      needsRefresh = false;
      setState((old) => ({ ...old, loading: true }));
      try {
        const data = await loader.current();
        if (!cancelled)
          setState({ data, error: '', loading: false, updatedAt: Date.now() });
        failures = 0;
      } catch (error) {
        if (!cancelled) {
          setState((old) => ({ ...old, error: String(error), loading: false }));
          needsRefresh = true;
          timer = setTimeout(
            () => void run(),
            [3000, 10000, 30000][Math.min(failures++, 2)],
          );
        }
      } finally {
        running = false;
      }
    };
    const visible = () => {
      if (document.hidden) clearTimeout(timer);
      else if (needsRefresh) void run();
    };
    document.addEventListener('visibilitychange', visible);
    if (debounceMs) timer = setTimeout(() => void run(), debounceMs);
    else void run();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [key, active, retry, debounceMs]);
  return { ...state, refresh };
}
