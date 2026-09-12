export type Combination = string[] | null;
export function toggleSelection(
  value: Combination,
  id: string,
  available: string[],
): string[] {
  const current = value ?? available;
  return current.includes(id)
    ? current.filter((v) => v !== id)
    : [...new Set([...current, id])];
}
export function invertSelection(
  value: Combination,
  available: string[],
): string[] {
  const selected = new Set(value ?? available);
  return available.filter((id) => !selected.has(id));
}
export function selectedFirst<T extends { id: string }>(
  options: T[],
  value: Combination,
): T[] {
  const selected = new Set(value ?? options.map((o) => o.id));
  return options
    .map((option, index) => ({ option, index }))
    .sort(
      (a, b) =>
        Number(selected.has(b.option.id)) - Number(selected.has(a.option.id)) ||
        a.index - b.index,
    )
    .map((v) => v.option);
}
