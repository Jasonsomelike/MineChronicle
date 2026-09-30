import { useState } from 'react';
import {
  Check,
  Clock3,
  GitFork,
  ShieldCheck,
  X,
  Undo2,
  ArrowUpRight,
} from 'lucide-react';
import { Button, Collapse, Select } from 'antd';
import { decideClone, reviewHealth, issueNames } from '../lib/health';
import type { HealthSummary, CloneCandidate } from '../lib/health';
import type { ScanSummary } from '../lib/scan';
import { displayPath } from '../lib/path';
import { formatPlayTicks } from '../lib/duration';
import { Pagination, Tabs, TextButton, tabId } from './ui';

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
            <TextButton onClick={() => onOpen(world.path)}>
              <strong>{world.name}</strong>
              <ArrowUpRight size={14} />
            </TextButton>
            <p className="world-path">{displayPath(world.path)}</p>
          </div>
        ))}
      </div>
      <p className="scan-note">
        发现时玩家
        UUID、完整统计内容和世界元数据一致。仅凭这些信息不能确定复制方向与继承时长。
      </p>
      {/* Two-level disclosure on antd Collapse (ghost): the evidence list, and
          inside each row the stats-file checksum. The `.clone-evidence` rows
          keep their class - the styles that lay them out key on it. */}
      <Collapse
        ghost
        items={[
          {
            key: 'evidence',
            label: (
              <>
                {candidate.evidence.length} 位玩家的匹配证据 ·{' '}
                {new Date(candidate.detected_at).toLocaleString()}
              </>
            ),
            children: candidate.evidence.map((e) => (
              <div key={e.uuid} className="clone-evidence">
                <strong>{names.get(e.uuid) ?? e.uuid}</strong>
                <span>{formatPlayTicks(e.ticks)}</span>
                <code>{e.uuid}</code>
                <Collapse
                  ghost
                  items={[
                    {
                      key: 'stats-hash',
                      label: '统计文件校验信息',
                      children: (
                        <code title={e.stats_hash}>{e.stats_hash}</code>
                      ),
                    },
                  ]}
                />
              </div>
            )),
          },
        ]}
      />
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
            <Select
              value={parent || undefined}
              placeholder="请选择原世界"
              onChange={(value) => setParent(value)}
              disabled={busy}
              options={[candidate.world_a, candidate.world_b].map((w) => ({
                value: String(w.id),
                label: `${w.name} · ${displayPath(w.path)}`,
              }))}
            />
          </label>
          <div className="health-actions">
            <Button
              type="primary"
              disabled={busy || !parent}
              icon={<Check size={15} />}
              onClick={() => void decide('confirmed')}
            >
              确认复制 / 分支
            </Button>
            <Button
              disabled={busy}
              icon={<X size={15} />}
              onClick={() => void decide('rejected')}
            >
              独立世界
            </Button>
            <TextButton
              disabled={busy || candidate.status === 'deferred'}
              onClick={() => void decide('deferred')}
            >
              <Clock3 size={15} />
              稍后处理
            </TextButton>
          </div>
        </>
      ) : (
        <TextButton disabled={busy} onClick={() => void decide('pending')}>
          <Undo2 size={15} />
          撤销复核
        </TextButton>
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
      {/* This section is a review queue, not a setting: it is something you come back
          to when there is work, whereas a setting is something you look up. Collapsed
          by default, with the pending count kept in the summary, so nothing
          actionable is hidden - the summary states whether there is anything to open
          it for. The <section> wrapper stays so the landmark survives. */}
      <details className="health-disclosure">
        <summary className="settings-section-head">
          <h2>
            <ShieldCheck size={18} aria-hidden="true" />
            数据健康
          </h2>
          {/* Flagged rather than merely counted when there is work: a collapsed queue
              that looks the same whether or not it needs attention is how a
              disclosure turns into a hiding place. */}
          <span>
            <span
              className={health.pending_count ? 'health-pending' : undefined}
            >
              {health.pending_count
                ? `${health.pending_count} 项待处理`
                : '无待处理'}
            </span>{' '}
            · {health.confirmed_lineages} 条确认关联
          </span>
        </summary>
        <div className="health-disclosure-body">
          {/* Was a hand-rolled tablist: `role="tab"` with `aria-selected` and no panel,
              no `aria-controls` and no arrow keys, so the role promised a keyboard model
              the markup did not implement. The primitive owns the tablist now, and the
              panel below is the element the tabs actually control. */}
          <Tabs
            id="health-review"
            label="复核状态"
            value={tab}
            options={
              [
                ['pending', '待处理'],
                ['reviewed', '已复核'],
                ['all', '全部'],
              ] as const
            }
            onChange={(next) => {
              setTab(next);
              setPage(0);
            }}
            panelId="health-review-panel"
          />
          <div
            role="tabpanel"
            id="health-review-panel"
            aria-labelledby={tabId('health-review', tab)}
          >
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
                    <Button
                      disabled={!!busy}
                      icon={
                        row.item.reviewed ? (
                          <Undo2 size={15} />
                        ) : (
                          <Check size={15} />
                        )
                      }
                      onClick={() =>
                        void review(row.item.key, !row.item.reviewed)
                      }
                    >
                      {row.item.reviewed ? '恢复待处理' : '标记已复核'}
                    </Button>
                    {row.item.target ? (
                      <TextButton onClick={() => onOpen(row.item.target)}>
                        <ArrowUpRight size={15} />
                        查找相关世界
                      </TextButton>
                    ) : null}
                  </div>
                </article>
              ),
            )}
            {pages > 1 ? (
              <Pagination
                page={current}
                pages={pages}
                onPrev={() => setPage(current - 1)}
                onNext={() => setPage(current + 1)}
                onJump={setPage}
              />
            ) : null}
          </div>
        </div>
      </details>
    </section>
  );
}
