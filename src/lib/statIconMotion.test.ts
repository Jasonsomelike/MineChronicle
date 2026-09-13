import { describe, expect, it } from 'vitest';
import {
  animateDiscoveredStatIcons,
  newlyDiscoveredIds,
  prefersReducedMotion,
} from './statIconMotion';

describe('stat icon motion helpers', () => {
  it('returns only newly discovered ids', () => {
    expect(newlyDiscoveredIds(['a', 'b'], ['b', 'c', 'd'])).toEqual(['c', 'd']);
    expect(newlyDiscoveredIds([], ['a'])).toEqual(['a']);
    expect(newlyDiscoveredIds(['a'], ['a'])).toEqual([]);
  });

  it('honors reduced motion without touching the DOM', () => {
    expect(prefersReducedMotion({ matches: true })).toBe(true);
    expect(prefersReducedMotion({ matches: false })).toBe(false);
    expect(
      animateDiscoveredStatIcons(['minecraft:stone'], null, { matches: true }),
    ).toBeNull();
  });

  it('returns null when no matching sprite nodes exist', () => {
    expect(
      animateDiscoveredStatIcons(
        ['example:missing'],
        { querySelector: () => null },
        { matches: false },
      ),
    ).toBeNull();
  });
});
