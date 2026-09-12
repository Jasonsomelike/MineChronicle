import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Radar, RefreshCw } from 'lucide-react';
import { loadObservedSessions } from '../lib/tracking';
import type { TrackingSummary } from '../lib/tracking';
import { usePageActive } from './SessionPage';
import ObservedSessions from './ObservedSessions';

export default function InstanceObservation({
  children,
}: {
  children: ReactNode;
}) {
  const active = usePageActive();
  const [sessions, setSessions] =
    useState<TrackingSummary['sessions']>(undefined);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!active) return;
    let cancelled = false,
      busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const rows = await loadObservedSessions();
        if (!cancelled) {
          setSessions(rows);
          setError('');
        }
      } catch (cause) {
        if (!cancelled) setError(`观测记录读取失败：${String(cause)}`);
      } finally {
        busy = false;
      }
    };
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active, retry]);
  return (
    <section className="instance-observation" aria-label="实例观测">
      <div className="library-heading">
        <h2>
          <Radar size={22} /> 实例观测
        </h2>
        <span className="scan-note">记录保存在本地档案中</span>
      </div>
      <div className="settings-card observation-controls">{children}</div>
      {error ? (
        <p role="alert" className="scan-error">
          {error}{' '}
          <button
            className="secondary-button"
            onClick={() => setRetry((v) => v + 1)}
          >
            <RefreshCw size={14} /> 重试
          </button>
        </p>
      ) : null}
      {sessions ? (
        <ObservedSessions sessions={sessions} />
      ) : !error ? (
        <p role="status">正在读取历史观测记录…</p>
      ) : null}
    </section>
  );
}
