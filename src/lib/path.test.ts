import { expect, it } from 'vitest';
import { displayPath } from './path';
it('formats drive and UNC paths without changing spaces or ordinary paths', () => {
  expect(displayPath(String.raw`\\?\D:\Games\saves\111  `)).toBe(
    String.raw`D:\Games\saves\111  `,
  );
  expect(displayPath(String.raw`\\?\UNC\server\share\world`)).toBe(
    String.raw`\\server\share\world`,
  );
  expect(displayPath(String.raw`D:\Games\world`)).toBe(
    String.raw`D:\Games\world`,
  );
  expect(displayPath(String.raw`\\?\Volume{test}\world`)).toBe(
    String.raw`\\?\Volume{test}\world`,
  );
});
