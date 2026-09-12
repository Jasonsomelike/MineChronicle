import { useState } from 'react';
import {
  Check,
  Clock3,
  GitFork,
  X,
  Undo2,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { decideClone, reviewHealth, issueNames } from '../lib/health';
import type { HealthSummary, CloneCandidate } from '../lib/health';
import type { ScanSummary } from '../lib/scan';
import { displayPath } from '../lib/path';
import { formatPlayTicks } from '../lib/duration';

function Candidate({
  candidate,
  onSaved,
  onOpen,
  names,
}: {
  candidate: CloneCandidate;
  onSaved: (h: HealthSummary) => void;
  onOpen: (q: string) => void;
  names: Map<string, string>;
}) {
  const [parent, setParent] = useState(
    candidate.parent_world_id?.toString() ?? '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function decide(status: string) {
    setBusy(true);
    setError('');
    try {
      onSaved(
        await decideClone(
          candidate.id,
          status,
          status === 'confirmed' ? Number(parent) : null,
        ),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="clone-candidate">
      <div className="health-item-heading">
        <h3>
          <GitFork size={16} />
          两个世界可能拥有共同历史
        </h3>
        <span>
          {
            {
              pending: '待复核',
              deferred: '稍后处理',
              confirmed: '已确认关联',
              rejected: '独立世界',
            }[candidate.status]
          }
        </span>
      </div>
      <div className="clone-worlds">
        {[candidate.world_a, candidate.world_b].map((world) => (
          <div key={world.id}>
            <button
              className="text-button"
              type="button"
              onClick={() => onOpen(world.path)}
            >
              <strong>{world.name}</strong>
              <ArrowUpRight size={14} />
            </button>
            <p className="world-path">{displayPath(world.path)}</p>
          </div>
        ))}
      </div>
      <p className="scan-note">
        发现时玩家
        UUID、完整统计内容和世界元数据一致。仅凭这些信息不能确定复制方向与继承时长。
      </p>
      <details>
        <summary>
          {candidate.evidence.length} 位玩家的匹配证据 ·{' '}
          {new Date(candidate.detected_at).toLocaleString()}
        </summary>
        {candidate.evidence.map((e) => (
          <div key={e.uuid} className="clone-evidence">
            <strong>{names.get(e.uuid) ?? e.uuid}</strong>
            <span>{formatPlayTicks(e.ticks)}</span>
            <code>{e.uuid}</code>
            <details>
              <summary>统计文件校验信息</summary>
              <code title={e.stats_hash}>{e.stats_hash}</code>
            </details>
          </div>
        ))}
      </details>
      {candidate.status === 'confirmed' ? (
        <p className="lineage-note">
          原世界：
          {candidate.parent_world_id === candidate.world_a.id
            ? candidate.world_a.name
            : candidate.world_b.name}{' '}
          · 继承时长未知。当前统计尚未扣减。
        </p>
      ) : null}
      {candidate.status === 'pending' || candidate.status === 'deferred' ? (
        <>
          <label className="lineage-parent">
            原世界
            <select
              value={parent}
              onChange={(e) => setParent(e.target.value)}
              disabled={busy}
            >
              <option value="">请选择原世界</option>
              {[candidate.world_a, candidate.world_b].map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} · {displayPath(w.path)}
                </option>
              ))}
            </select>
          </label>
          <div className="health-actions">
            <button
              type="button"
              disabled={busy || !parent}
              onClick={() => void decide('confirmed')}
            >
              <Check size={15} />
              确认复制 / 分支
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => void decide('rejected')}
            >
              <X size={15} />
              独立世界
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy || candidate.status === 'deferred'}
              onClick={() => void decide('deferred')}
            >
              <Clock3 size={15} />
              稍后处理
            </button>
          </div>
        </>
      ) : (
        <button
          className="text-button"
          type="button"
          disabled={busy}
          onClick={() => void decide('pending')}
        >
          <Undo2 size={15} />
          撤销复核
        </button>
      )}
      {error ? (
        <p role="alert" className="scan-error">
          {error}
        </p>
      ) : null}
    </article>
  );
}
export default function DataHealth({
  health,
  report,
  onSaved,
  onOpen,
}: {
  health: HealthSummary | null;
  report: ScanSummary;
  onSaved: (h: HealthSummary) => void;
  onOpen: (q: string) => void;
}) {
  const [tab, setTab] = useState('pending');
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  if (!health) return <p role="status">正在读取数据健康…</p>;
  const names = new Map(
    report.roots.flatMap((r) =>
      r.worlds.flatMap((w) =>
        w.players
          .filter((p) => p.preferred_name)
          .map((p) => [p.uuid, p.preferred_name!] as const),
      ),
    ),
  );
  const candidates = health.candidates.filter(
    (c) =>
      tab === 'all' ||
      (tab === 'pending'
        ? c.status === 'pending' || c.status === 'deferred'
        : c.status === 'confirmed' || c.status === 'rejected'),
  );
  const issues = health.items.filter(
    (i) => tab === 'all' || (tab === 'pending' ? !i.reviewed : i.reviewed),
  );
  const rows = [
    ...candidates.map((candidate) => ({ type: 'clone' as const, candidate })),
    ...issues.map((item) => ({ type: 'issue' as const, item })),
  ];
  const pages = Math.max(1, Math.ceil(rows.length / 12));
  const current = Math.min(page, pages - 1);
  async function review(key: string, reviewed: boolean) {
    setBusy(key);
    setError('');
    try {
      onSaved(await reviewHealth(key, reviewed));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy('');
    }
  }
  return (
    <section className="data-health" aria-label="数据健康">
      <div className="library-heading">
        <h2>数据健康</h2>
        <span>
          {health.pending_count} 项待处理 · {health.confirmed_lineages}{' '}
          条确认关联
        </span>
      </div>
      <div role="tablist" aria-label="复核状态" className="health-tabs">
        {[
          ['pending', '待处理'],
          ['reviewed', '已复核'],
          ['all', '全部'],
        ].map(([key, label]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => {
              setTab(key);
              setPage(0);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {health.analysis_limited ? (
        <p role="alert" className="scan-error">
          本次候选分析达到 2000 对上限，部分候选尚未列出。
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="scan-error">
          {error}
        </p>
      ) : null}
      {!rows.length ? (
        <p className="health-empty">
          {tab === 'pending' ? '暂无待处理问题。' : '此分类暂无记录。'}
        </p>
      ) : null}
      {rows.slice(current * 12, current * 12 + 12).map((row) =>
        row.type === 'clone' ? (
          <Candidate
            key={`clone:${row.candidate.id}`}
            candidate={row.candidate}
            names={names}
            onSaved={onSaved}
            onOpen={onOpen}
          />
        ) : (
          <article className="health-issue" key={row.item.key}>
            <div className="health-item-heading">
              <h3>{issueNames[row.item.kind] ?? row.item.kind}</h3>
              <span>{row.item.reviewed ? '已复核' : '待处理'}</span>
            </div>
            <p>{row.item.detail}</p>
            {row.item.path ? (
              <p className="world-path">{displayPath(row.item.path)}</p>
            ) : null}
            <div className="health-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={!!busy}
                onClick={() => void review(row.item.key, !row.item.reviewed)}
              >
                {row.item.reviewed ? <Undo2 size={15} /> : <Check size={15} />}{' '}
                {row.item.reviewed ? '恢复待处理' : '标记已复核'}
              </button>
              {row.item.target ? (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => onOpen(row.item.target)}
                >
                  <ArrowUpRight size={15} />
                  查找相关世界
                </button>
              ) : null}
            </div>
          </article>
        ),
      )}
      {pages > 1 ? (
        <div className="pagination">
          <label>
            跳转到{' '}
            <select
              aria-label="数据健康页码"
              value={current}
              onChange={(event) => setPage(Number(event.target.value))}
            >
              {Array.from({ length: pages }, (_, i) => (
                <option key={i} value={i}>
                  第 {i + 1} 页
                </option>
              ))}
            </select>
          </label>
          <button
            title="上一页"
            aria-label="上一页"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span>
            {current + 1} / {pages}
          </span>
          <button
            title="下一页"
            aria-label="下一页"
            disabled={current === pages - 1}
            onClick={() => setPage(current + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      ) : null}
    </section>
  );
}
