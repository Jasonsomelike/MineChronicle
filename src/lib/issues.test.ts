import { expect, it } from 'vitest';
import { groupIssues } from './issues';
it('shows repeated causes once, retaining distinct paths without duplicates', () => {
  expect(
    groupIssues([
      { kind: 'LIMIT', message: 'Depth limit', path: 'a' },
      { kind: 'LIMIT', message: 'Depth limit', path: 'b' },
      { kind: 'LIMIT', message: 'Depth limit', path: 'a' },
      { kind: 'PARSE', message: 'Corrupt JSON', path: 'c' },
    ]),
  ).toEqual([
    { kind: 'LIMIT', message: 'Depth limit', paths: ['a', 'b'] },
    { kind: 'PARSE', message: 'Corrupt JSON', paths: ['c'] },
  ]);
});
