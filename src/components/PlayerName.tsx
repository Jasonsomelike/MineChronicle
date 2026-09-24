import { useState } from 'react';
import type { PlayerSummary, ScanSummary } from '../lib/scan';
import { setPlayerAlias } from '../lib/scan';

export default function PlayerName({
  player,
  disabled,
  onSaved,
}: {
  player: PlayerSummary;
  disabled: boolean;
  onSaved: (report: ScanSummary) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setSaving(true);
    setError('');
    try {
      onSaved(await setPlayerAlias(player.uuid, name));
      setEditing(false);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="player-name">
      <strong>{player.preferred_name ?? '名称未解析'}</strong>
      <span>
        {player.name_source === 'manual'
          ? '手动别名'
          : player.name_source === 'usercache'
          ? '本地名称缓存'
          : '可手动填写名称'}
      </span>
      <code>{player.uuid}</code>
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label>
            玩家名称
            <input
              value={name}
              maxLength={64}
              required
              disabled={saving || disabled}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <button disabled={saving || disabled || !name.trim()}>
            {saving ? '保存中…' : '保存名称'}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={saving}
            onClick={() => {
              // Leaving the form is also leaving the failure: the error belongs to the
              // attempt, so it does not sit here waiting for the next one.
              setError('');
              setEditing(false);
            }}
          >
            取消
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="secondary-button"
          disabled={disabled}
          onClick={() => {
            setName(player.preferred_name ?? '');
            setEditing(true);
          }}
        >
          设置名称
        </button>
      )}
      {error ? (
        /* The failure used to be the raw backend string on its own, with no way back: the
           form stayed open but nothing said whether the name had changed or that the save
           could be tried again. What is true now, then the action - the shape `ReadStatus`
           already uses. */
        <p role="alert" className="scan-error">
          {error} · 原有名称保持不变。{' '}
          <button
            type="button"
            className="text-button"
            disabled={saving || disabled || !name.trim()}
            onClick={() => void save()}
          >
            立即重试
          </button>
        </p>
      ) : null}
    </div>
  );
}
