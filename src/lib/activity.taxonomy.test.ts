import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { statisticsGroups } from './activity';

/**
 * The statistics category taxonomy exists in two places: the Rust backend
 * (`STATISTICS_CATEGORIES` in database/activity.rs) decides grouping and sends
 * the labels, and this frontend list decides the tabs. They must agree, or a
 * category would render under one name and filter under another.
 *
 * The lists are deliberately not merged: the frontend also needs an "all" tab
 * (which the backend never sends) and must render every tab even when its count
 * is zero, whereas the backend omits zero-count categories from its payload.
 * This test guards against the two drifting apart instead.
 *
 * The Rust source is read directly because the taxonomies are compile-time
 * constants on that side; a runtime round trip would not catch a stale build.
 */
function backendCategories(): [string, string][] {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src-tauri', 'src', 'database', 'activity.rs'),
    'utf8',
  );
  const block = source.match(
    /const STATISTICS_CATEGORIES: &\[\(&str, &str\)\] = &\[([\s\S]*?)\];/,
  );
  if (!block) throw new Error('STATISTICS_CATEGORIES not found in activity.rs');
  return [...block[1].matchAll(/\("([^"]+)", "([^"]+)"\)/g)].map((m) => [
    m[1],
    m[2],
  ]);
}

describe('statistics category taxonomy', () => {
  it('frontend tabs are the backend categories plus a local "all" tab', () => {
    const backend = backendCategories();
    const frontend = statisticsGroups.map(([id, label]) => [id, label]);

    expect(frontend[0]).toEqual(['all', '全部']);
    expect(frontend.slice(1)).toEqual(backend);
  });

  it('parses a non-trivial backend list, so the check cannot pass vacuously', () => {
    const backend = backendCategories();
    expect(backend.length).toBeGreaterThanOrEqual(8);
    expect(backend.map(([id]) => id)).toContain('mined');
  });
});
