/** Commit a revision only after both loading and applying its data succeed. */
export function revisionRefresh<T>(
  load: () => Promise<T | null>,
  apply: (value: T) => void,
) {
  let committed: number | undefined;
  return async (revision: number) => {
    if (revision === committed) return;
    const value = await load();
    if (value === null) throw new Error('本地档案读取未返回数据');
    apply(value);
    committed = revision;
  };
}
