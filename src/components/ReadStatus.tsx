export default function ReadStatus({
  error,
  loading,
  updatedAt,
  refresh,
}: {
  error: string;
  loading: boolean;
  updatedAt: number;
  refresh: () => void;
}) {
  return (
    <div className="read-status">
      {updatedAt > 0 && (
        <small title={`最近更新 ${new Date(updatedAt).toLocaleString()}`}>
          已缓存数据
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
