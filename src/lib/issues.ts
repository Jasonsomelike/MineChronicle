import type { ScanSummary } from './scan';

/** One notice per cause; paths remain available inside the grouped detail. */
export function groupIssues(issues: ScanSummary['issues']) {
  const groups = new Map<
    string,
    { kind: string; message: string; paths: string[] }
  >();
  for (const issue of issues) {
    const key = JSON.stringify([issue.kind, issue.message]);
    const group = groups.get(key);
    if (group) {
      if (!group.paths.includes(issue.path)) group.paths.push(issue.path);
    } else
      groups.set(key, {
        kind: issue.kind,
        message: issue.message,
        paths: [issue.path],
      });
  }
  return [...groups.values()];
}
