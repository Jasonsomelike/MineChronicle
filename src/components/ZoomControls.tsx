import { useCallback, useEffect, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import {
  applyZoom,
  loadZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  normalizeZoom,
  saveZoom,
  ZOOM_PRESETS,
} from '../lib/zoom';
import './ZoomControls.css';

export default function ZoomControls() {
  const [value, setValue] = useState(loadZoom);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requested = useRef(value);
  const applied = useRef(100);
  const sequence = useRef(0);
  const alive = useRef(true);

  /* `restore` marks the call the effect makes on arrival. Re-applying a saved
     preference is a background sync, not a request: when that one fails there is
     nothing the reader did and no retry that would help them make it - and in a build
     that reports itself as Tauri without the webview internals behind it (the browser
     预览 with the QA fixture), the settings page opened with 未能调整界面缩放，请重试
     in red beside a control nobody had touched, which reads as a broken page. A
     failure the reader did ask for - the buttons, the select, Ctrl + 滚轮 - still says
     so, which is the moment the message can be acted on. */
  const changeZoom = useCallback(
    async (next: number, { restore = false } = {}) => {
      const target = normalizeZoom(next);
      const current = ++sequence.current;
      requested.current = target;
      setValue(target);
      setBusy(true);
      setError('');
      try {
        await applyZoom(target);
        applied.current = target;
        saveZoom(target);
        if (!alive.current || current !== sequence.current) return;
      } catch {
        if (!alive.current || current !== sequence.current) return;
        requested.current = applied.current;
        setValue(applied.current);
        if (!restore) setError('未能调整界面缩放，请重试。');
      }
      if (alive.current && current === sequence.current) setBusy(false);
    },
    [],
  );

  useEffect(() => {
    alive.current = true;
    void changeZoom(requested.current, { restore: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const next =
        event.key === '+' || event.key === '='
          ? requested.current + 25
          : event.key === '-' || event.key === '_'
          ? requested.current - 25
          : event.key === '0'
          ? 100
          : null;
      if (next === null) return;
      event.preventDefault();
      void changeZoom(next);
    };
    window.addEventListener('keydown', onKeyDown);
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !event.deltaY) return;
      event.preventDefault();
      void changeZoom(requested.current + (event.deltaY < 0 ? 5 : -5));
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      alive.current = false;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('wheel', onWheel);
    };
  }, [changeZoom]);

  const options = [...new Set<number>([...ZOOM_PRESETS, value])].sort(
    (a, b) => a - b,
  );

  return (
    <div className="zoom-controls-wrap">
      <div
        className="zoom-controls"
        role="group"
        aria-label="界面缩放"
        aria-busy={busy}
      >
        <button
          type="button"
          title="缩小界面"
          aria-label="缩小界面"
          disabled={value <= MIN_ZOOM}
          onClick={() => void changeZoom(requested.current - 25)}
        >
          <Minus size={15} />
        </button>
        <select
          aria-label="界面缩放比例"
          title="界面缩放比例"
          value={value}
          onChange={(event) => void changeZoom(Number(event.target.value))}
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option}%
            </option>
          ))}
        </select>
        <button
          type="button"
          title="放大界面"
          aria-label="放大界面"
          disabled={value >= MAX_ZOOM}
          onClick={() => void changeZoom(requested.current + 25)}
        >
          <Plus size={15} />
        </button>
        <button
          type="button"
          className="zoom-reset"
          title="恢复 100%"
          aria-label="恢复 100% 缩放"
          disabled={value === 100 && !error}
          onClick={() => void changeZoom(100)}
        >
          <RotateCcw size={14} />
        </button>
      </div>
      {error ? (
        <span className="zoom-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
