import type { ScanSummary } from '../lib/scan';
import { playerOptions } from '../lib/players';
import CombinationPicker from './CombinationPicker';
import { UserRound } from 'lucide-react';
import { resolveSelfPlayer, useSelfPlayer } from '../lib/selfPlayer';
export default function PlayerPicker({
  report,
  value,
  onChange,
  none = false,
}: {
  report: ScanSummary;
  value: string[];
  none?: boolean;
  onChange: (ids: string[], none?: boolean) => void;
}) {
  const players = playerOptions(report);
  const identity = useSelfPlayer();
  const matches = resolveSelfPlayer(identity, players);
  const selfIds = matches.map(([id]) => id);
  return (
    <CombinationPicker
      stableWhileOpen
      pinned={
        matches.length ? (
          <button
            type="button"
            className="self-player-shortcut"
            aria-pressed={
              !none &&
              (value.length
                ? value.length === selfIds.length &&
                  selfIds.every((id) => value.includes(id))
                : selfIds.length === players.length)
            }
            onClick={() => onChange(selfIds, false)}
            title="仅选择自己"
          >
            <UserRound size={19} aria-hidden="true" />
            <span>
              <strong>自己</strong>
              <small>
                {matches[0][1]} ·{' '}
                {matches.length > 1
                  ? `选择全部 ${matches.length} 个同名账号`
                  : '仅选择此玩家'}
              </small>
            </span>
          </button>
        ) : (
          <a className="self-player-shortcut" href="#/settings">
            <UserRound size={19} aria-hidden="true" />
            <span>
              <strong>自己</strong>
              <small>
                {identity
                  ? '尚未匹配本地玩家 · 前往设置'
                  : '尚未配置 · 前往设置'}
              </small>
            </span>
          </a>
        )
      }
      label="统计玩家"
      options={players.map(([id, label]) => ({ id, label, detail: id }))}
      value={none ? [] : value.length ? value : null}
      onChange={(selected) =>
        onChange(selected ?? [], selected !== null && !selected.length)
      }
    />
  );
}
