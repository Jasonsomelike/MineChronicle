export default function ReadStatus({
  error,
  loading,
  updatedAt,
  refresh,
  label,
}: {
  error: string;
  loading: boolean;
  updatedAt: number;
  refresh: () => void;
  /** Which read this freshness belongs to, for pages that show two of these. */
  label?: string;
}) {
  return (
    <div className="read-status">
      {updatedAt > 0 && (
        <small title={`最近更新 ${new Date(updatedAt).toLocaleString()}`}>
          {label ? `${label} · ` : ''}最近更新{' '}
          {new Date(updatedAt).toLocaleTimeString()}
        </small>
      )}
      {loading && <span role="status">正在更新…</span>}
      {error && (
        <p role="alert" className="scan-error">
          {error} ·{' '}
          {updatedAt ? '保留最近成功的数据，将自动重试。' : '将自动重试。'}{' '}
          <button type="button" className="text-button" onClick={refresh}>
            立即重试
          </button>
        </p>
      )}
    </div>
  );
}
