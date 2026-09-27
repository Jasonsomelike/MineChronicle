import { useEffect, useRef, useState } from 'react';
import { Button, Modal } from 'antd';
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
import { TextButton } from './ui';

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
 *
 * The hand-written <dialog> became an antd Modal, and the StrictMode dance the
 * native element forced is gone with it: `showModal` had to run in an effect,
 * whose cleanup fired `close` during the StrictMode remount and - without the
 * `userClosed` flag - would have unmounted the dialog before it was ever seen
 * (verified in the browser; see the history below). The Modal is controlled by
 * an `open` state instead, so a remount just re-renders it. The flag survives
 * with a narrower job: only a user-intended close may reach the parent, because
 * `afterClose` also fires after the programmatic hide that follows save/undo.
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
  const field = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(true);
  const [bounds, setBounds] = useState<ManualEndBounds | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isManual = session.ended_source === 'manual';
  // True only when the close came from the user (cancel, save, undo) - not
  // from a programmatic hide the parent should not react to twice.
  const userClosed = useRef(false);

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

  /**
   * Report a validation failure and put the caret back in the field.
   *
   * The error is rendered next to the input, but without moving focus a keyboard
   * user stays on the 保存 button and has to tab backwards to find what to fix.
   * The skill's `focus-management` rule asks for exactly this. Every failure path
   * goes through here so none of them can forget it.
   */
  function fail(message: string) {
    setError(message);
    field.current?.focus();
  }

  async function save() {
    if (busy) return;
    setError('');
    if (!value) {
      fail('请填写结束时间');
      return;
    }
    if (!local) {
      fail('结束时间格式无法识别');
      return;
    }
    // Client-side checks exist only to answer quickly; the backend re-validates
    // and its message is the authoritative one.
    if (preview === null) {
      fail('结束时间必须晚于开始时间');
      return;
    }
    if (Date.parse(local) > Date.now()) {
      fail('结束时间不能晚于当前时间');
      return;
    }
    if (
      bounds?.max_ended_at &&
      Date.parse(local) > Date.parse(bounds.max_ended_at)
    ) {
      fail(`不能晚于下一次会话开始时间 ${upperLabel}`);
      return;
    }
    setBusy(true);
    try {
      await setSessionEnd(session.id, local);
      onSaved();
      userClosed.current = true;
      setOpen(false);
    } catch (cause: unknown) {
      fail(String(cause));
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
      setOpen(false);
    } catch (cause: unknown) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Close because the user asked to - Escape, the mask, or the 取消 button.
   * The Modal's own close paths all funnel here, mirroring the native
   * `onCancel` handling the <dialog> version had.
   */
  function requestClose() {
    if (busy) return;
    userClosed.current = true;
    setOpen(false);
  }

  return (
    <Modal
      open={open}
      /* The native dialog's width cap, carried over verbatim. */
      width="min(460px, calc(100% - 32px))"
      className="session-end-dialog"
      title={isManual ? '修改结束时间' : '填写结束时间'}
      /* The native dialog had no close X; the escape hatch was Esc, the mask,
         and the 取消 button - keep exactly those. Motion is off (empty
         transition names fall through to "no motion" in rc-dialog): the app's
         reduced-motion reset (styles.css) removes the very animation/transition
         events antd's leave animation waits for, which left the closing modal
         stuck half-invisible under prefers-reduced-motion: reduce - the native
         dialog closed instantly, and instant is what a desktop dialog should
         do anyway. */
      transitionName=""
      maskTransitionName=""
      maskClosable
      keyboard
      onCancel={requestClose}
      /* With motion off, afterClose lands on the same tick as the hide - the
         equivalent of the native element's `close` event. */
      afterClose={() => {
        if (userClosed.current) onClose();
      }}
      footer={[
        ...(isManual
          ? [
              <TextButton
                key="undo"
                disabled={busy}
                onClick={() => void undo()}
              >
                撤销手动填写
              </TextButton>,
            ]
          : []),
        <Button key="cancel" disabled={busy} onClick={requestClose}>
          取消
        </Button>,
        <Button
          key="save"
          type="primary"
          loading={busy}
          disabled={busy || !bounds}
          onClick={() => void save()}
        >
          {busy ? '保存中…' : '保存'}
        </Button>,
      ]}
    >
      <div className="session-end-body">
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
            ref={field}
            type="datetime-local"
            step={1}
            autoFocus
            value={value}
            disabled={busy}
            // Ties the message below to this field for screen readers, and
            // marks it invalid so the state is announced rather than only seen.
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'session-end-error' : undefined}
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
          <p className="session-end-error" id="session-end-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
