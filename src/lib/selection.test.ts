import { describe, it, expect } from 'vitest';
import { toggleSelection, invertSelection, selectedFirst } from './selection';
describe('combination selection', () => {
  it('distinguishes all and none and inverts both', () => {
    expect(invertSelection(null, ['a', 'b'])).toEqual([]);
    expect(invertSelection([], ['a', 'b'])).toEqual(['a', 'b']);
    expect(toggleSelection(null, 'a', ['a', 'b'])).toEqual(['b']);
    expect(toggleSelection(['a'], 'a', ['a', 'b'])).toEqual([]);
  });
  it('retains a union and stable selected-first ordering', () => {
    expect(toggleSelection(['b'], 'a', ['a', 'b', 'c'])).toEqual(['b', 'a']);
    expect(
      selectedFirst([{ id: 'a' }, { id: 'b' }, { id: 'c' }], ['c', 'b']).map(
        (o) => o.id,
      ),
    ).toEqual(['b', 'c', 'a']);
  });
});
