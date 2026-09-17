import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

/**
 * Contains a render-time crash so one broken view cannot blank the whole app.
 * React only routes render/lifecycle errors here; async failures are already
 * handled per call by the lib helpers.
 *
 * `resetKey` clears a caught error when it changes, so leaving and returning to
 * a page (or switching pages) retries instead of showing a stale fallback.
 */
export default class ErrorBoundary extends Component<
  { children: ReactNode; label?: string; resetKey?: unknown },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Local diagnostics only: no telemetry, no network, no player data.
    console.error(
      `MineChronicle 界面异常（${this.props.label ?? 'root'}）`,
      error,
      info.componentStack,
    );
  }

  componentDidUpdate(previous: { resetKey?: unknown }) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const scope = this.props.label
      ? `“${this.props.label}”页面`
      : 'MineChronicle 界面';
    return (
      <section className="error-boundary" role="alert">
        <AlertTriangle size={30} aria-hidden="true" />
        <h2>{scope}遇到问题</h2>
        <p>
          档案数据没有被修改。可以重试；若反复出现，请记录下面的信息后再反馈。
        </p>
        <p className="error-boundary-detail">
          <code>{error.message || String(error)}</code>
        </p>
        <div className="scan-actions">
          <button type="button" onClick={() => this.setState({ error: null })}>
            <RotateCw size={15} />
            重试
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => window.location.reload()}
          >
            重新加载界面
          </button>
        </div>
      </section>
    );
  }
}
