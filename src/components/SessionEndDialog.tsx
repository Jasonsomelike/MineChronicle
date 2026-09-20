import { useEffect, useRef, useState } from 'react';
import type { ObservedSessionsPage } from '../lib/tracking';
import {
  clearSessionEnd,
  loadSessionBounds,
  setSessionEnd,
} from '../lib/tracking';
import type { ManualEndBounds } from '../lib/tracking';
import {
  formatSeconds,
  localInputToUtc,
  utcToLocalInput,
} from '../lib/duration';

type Session = NonNullable<ObservedSessionsPage['sessions']>[number];

/** Seconds between two stored UTC timestamps, or null when not comparable. */
function spanSeconds(from: string, to: string): string | null {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  return String(Math.floor((end - start) / 1000));
}

/**
 * Fill in, correct, or undo the end time of one observed session.
 *
 * Only the user knows when a game actually stopped after the observer itself
 * shut down, so this is the one place a session end can come from outside the
 * process probe. Everything typed here is marked as manual and can be undone.
 */
export default function SessionEndDialog({
  session,
  onClose,
  onSaved,
}: {
  session: Session;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [bounds, setBounds] = useState<ManualEndBounds | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isManual = session.ended_source === 'manual';
  // Distinguishes closing *because* the user closed it from the dialog being
  // torn down by the effect's own cleanup.
  //
  // StrictMode mounts, runs the cleanup, then mounts again. The cleanup calls
  // `close()`, which fires the `close` event; without this flag that event would
  // call `onClose()`, the parent would unmount this component, and the dialog
  // would never appear at all. Verified in the browser.
  const userClosed = useRef(false);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => {
      userClosed.current = false;
      element?.close();
    };
  }, []);

  // The limits come from the backend so the dialog and the write agree. They are
  // recomputed again on save: the row can change while this is open.
  useEffect(() => {
    let cancelled = false;
    loadSessionBounds(session.id)
      .then((loaded) => {
        if (cancelled) return;
        setBounds(loaded);
        setValue(
          // Default to the recorded end when correcting, otherwise the start
          // time, which is the earliest legal value.
          utcToLocalInput(session.ended_at ?? loaded.started_at),
        );
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [session.id, session.ended_at]);

  const local = localInputToUtc(value);
  const preview = local && spanSeconds(session.started_at, local);
  const upperLabel = bounds?.max_ended_at
    ? new Date(bounds.max_ended_at).toLocaleString('zh-CN', { hour12: false })
    : null;

  async function save() {
    if (busy) return;
    setError('');
    if (!value) {
      setError('请填写结束时间');
      return;
    }
    if (!local) {
      setError('结束时间格式无法识别');
      return;
    }
    // Client-side checks exist only to answer quickly; the backend re-validates
    // and its message is the authoritative one.
    if (preview === null) {
      setError('结束时间必须晚于开始时间');
      return;
    }
    if (Date.parse(local) > Date.now()) {
      setError('结束时间不能晚于当前时间');
      return;
    }
    if (
      bounds?.max_ended_at &&
      Date.parse(local) > Date.parse(bounds.max_ended_at)
    ) {
      setError(`不能晚于下一次会话开始时间 ${upperLabel}`);
      return;
    }
    setBusy(true);
    try {
      await setSessionEnd(session.id, local);
      onSaved();
      // Closed through requestClose so the unmount does not happen while the
      // element is still in the modal state.
      userClosed.current = true;
      dialog.current?.close();
    } catch (cause: unknown) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      await clearSessionEnd(session.id);
      onSaved();
      userClosed.current = true;
      dialog.current?.close();
    } catch (cause: unknown) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Close because the user asked to, as opposed to the effect cleanup calling
   * `close()` during teardown. Only the former should reach the parent, or the
   * StrictMode remount would unmount this component before it is ever seen.
   */
  function requestClose() {
    if (busy) return;
    userClosed.current = true;
    dialog.current?.close();
  }

  return (
    <dialog
      ref={dialog}
      className="session-end-dialog"
      aria-label="填写观测结束时间"
      onCancel={(event) => {
        // Escape: suppress the default close so `requestClose` owns the path and
        // the flag is set.
        event.preventDefault();
        requestClose();
      }}
      onClose={() => {
        if (userClosed.current) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div className="session-end-body">
        <h3>{isManual ? '修改结束时间' : '填写结束时间'}</h3>
        <p className="session-end-note">
          该实例在运行，但本软件没观测到它关闭，所以结束时间未知。填入后这段时间会计入
          「未归因运行时长」。
        </p>
        <dl className="session-end-facts">
          <div>
            <dt>实例</dt>
            <dd title={session.game_root}>{session.instance_name}</dd>
          </div>
          <div>
            <dt>观测开始</dt>
            <dd>
              {new Date(session.started_at).toLocaleString('zh-CN', {
                hour12: false,
              })}
            </dd>
          </div>
          {session.ended_at ? (
            <div>
              <dt>当前结束</dt>
              <dd>
                {new Date(session.ended_at).toLocaleString('zh-CN', {
                  hour12: false,
                })}
                {isManual ? '（手动填写）' : '（观测所得）'}
              </dd>
            </div>
          ) : null}
        </dl>
        <label className="session-end-field">
          结束时间
          <input
            type="datetime-local"
            step={1}
            value={value}
            disabled={busy}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void save();
            }}
          />
        </label>
        <p className="scan-note">
          必须晚于开始时间
          {upperLabel ? `，且不晚于下一次会话开始时间 ${upperLabel}` : ''}
          ，也不能晚于当前时间。
        </p>
        {preview ? (
          <p className="scan-note">
            该次观测将计入 <strong>{formatSeconds(preview)}</strong>
            ；若这段时间本地存档有增长，会再扣除对应增量。
          </p>
        ) : null}
        {error ? (
          <p className="session-end-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="picker-actions">
          {isManual ? (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => void undo()}
            >
              撤销手动填写
            </button>
          ) : null}
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={requestClose}
          >
            取消
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={busy || !bounds}
            onClick={() => void save()}
          >
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
