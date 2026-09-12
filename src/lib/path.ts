/** Presentation only: never use this value as filesystem identity. */
export function displayPath(path: string): string {
  if (/^\\\\\?\\UNC\\/i.test(path)) return '\\\\' + path.slice(8);
  if (/^\\\\\?\\[a-z]:\\/i.test(path)) return path.slice(4);
  return path;
}

/** UI grouping only. Rust file identities remain authoritative. */
export function pathKey(path: string): string {
  return displayPath(path)
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}
