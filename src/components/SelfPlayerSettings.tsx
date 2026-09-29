import { useState } from 'react';
import { Button, Input } from 'antd';
import { TextButton } from './ui';
import type { ScanSummary } from '../lib/scan';
import { playerOptions } from '../lib/players';
import {
  resolveSelfPlayer,
  saveSelfPlayer,
  useSelfPlayerState,
  loadSelfPlayer,
} from '../lib/selfPlayer';

export default function SelfPlayerSettings({
  report,
}: {
  report: ScanSummary | null;
}) {
  const { value: saved, loaded, error } = useSelfPlayerState();
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const value = draft ?? saved;
  const matches = resolveSelfPlayer(value, report ? playerOptions(report) : []);
  return (
    <section className="settings-card settings-card--quiet self-player-settings">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!loaded || saving) return;
          setSaving(true);
          try {
            await saveSelfPlayer(value);
            setDraft(null);
            setMessage(
              value.trim()
                ? '已保存，所有玩家选择器立即生效。'
                : '已清除自己的玩家身份。',
            );
          } catch {
            setMessage('保存失败，请重试。');
          } finally {
            setSaving(false);
          }
        }}
      >
        {/* The row pattern the rest of the settings page uses - what the field is
            for on the left, the field itself on the right. The section head
            (身份) names the group, so this card carries no heading of its own. */}
        <div className="setting-row setting-row--first">
          <div>
            <strong>玩家名称 / UUID</strong>
            <p>
              设置自己的玩家身份，在玩家列表顶部一键选择。输入名称或
              UUID，任选一种即可。
            </p>
          </div>
          <div className="self-player-input">
            <Input
              id="self-player-identity"
              aria-label="玩家名称 / UUID"
              disabled={!loaded || saving}
              maxLength={256}
              value={value}
              placeholder="例如 Steve 或玩家 UUID"
              spellCheck={false}
              autoComplete="off"
              aria-describedby="self-player-match"
              onChange={(e) => {
                setDraft(e.target.value);
                setMessage('');
              }}
            />
            <Button
              type="primary"
              htmlType="submit"
              disabled={!loaded || saving}
            >
              {saving ? '保存中…' : '保存'}
            </Button>
          </div>
        </div>
        {error ? (
          <p role="alert">
            {error}{' '}
            <TextButton onClick={() => void loadSelfPlayer().catch(() => {})}>
              重试
            </TextButton>
          </p>
        ) : !loaded ? (
          <p role="status">正在读取已保存的身份…</p>
        ) : null}
        <p id="self-player-match" className="scan-note">
          {matches.length > 1
            ? `已匹配 ${matches.length} 个同名账号，点击“自己”将一起选中。填写 UUID 可只选择单个账号。`
            : matches.length
            ? `已匹配：${matches[0][1]} · ${matches[0][0]}`
            : value.trim()
            ? '本地档案中暂未找到此玩家；可以先保存，导入对应存档后即可选择。'
            : '仅匹配本地档案，不联网查询。留空保存可清除配置。'}
        </p>
        {matches.length > 1 ? (
          <details className="self-player-matches">
            <summary>查看匹配账号 · {matches.length}</summary>
            <ul>
              {matches.map(([id, name]) => (
                <li key={id}>
                  <strong>{name}</strong>
                  <code>{id}</code>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <p className="scan-note" role="status">
          {message}
        </p>
      </form>
    </section>
  );
}
