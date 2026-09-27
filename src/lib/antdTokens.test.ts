import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FONT_FAMILY, themeFor } from './antdTokens';

/**
 * warmth.css owns the palette and tokens.css owns the scales; antdTokens.ts
 * restates them for antd. Two fact sources for one value is how palettes drift,
 * so this suite parses the CSS and fails the moment the bridge disagrees with
 * the sheets - the same shape as the design gate's static pass, but at the
 * unit level where it can name the exact token.
 */
const here = dirname(fileURLToPath(import.meta.url));
const css = (path: string) => readFileSync(join(here, '../..', path), 'utf8');

/** Comment bodies out: a comment like "measured 3.65:1" carries a colon that
 *  would otherwise swallow the declaration fragment that follows it. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Pull one flat `:root`-shaped block out of a sheet and index its custom props. */
function block(text: string, selector: string): Record<string, string> {
  const source = stripComments(text);
  const start = source.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`block ${selector} not found`);
  const open = source.indexOf('{', start);
  const close = source.indexOf('}', open);
  const body = source.slice(open + 1, close);
  const props: Record<string, string> = {};
  for (const line of body.split(';')) {
    const at = line.indexOf(':');
    if (at < 0) continue;
    const name = line.slice(0, at).trim();
    if (name.startsWith('--'))
      props[name] = line
        .slice(at + 1)
        .trim()
        .replace(/\s+/g, ' ');
  }
  return props;
}

const warmth = css('src/warmth.css');
const light = block(warmth, ':root');
const dark = block(warmth, ":root[data-theme='dark']");
const tokens = block(css('src/styles/tokens.css'), ':root');

type Token = ReturnType<typeof themeFor>['token'] extends undefined
  ? never
  : NonNullable<NonNullable<ReturnType<typeof themeFor>>['token']>;

function tokenOf(mode: 'light' | 'dark'): Token {
  const config = themeFor(mode);
  return config.token ?? {};
}

describe('antdTokens ↔ warmth.css palette sync', () => {
  const PAIRS: [
    key: keyof ReturnType<typeof tokenOf> & string,
    prop: string,
  ][] = [
    // colorPrimary is the filled CTA surface (--surface-strong), not --brand:
    // in dark mode --brand is the accent while the CTA keeps the light blue.
    ['colorPrimary', '--surface-strong'],
    ['colorLink', '--text-accent'],
    ['colorBgLayout', '--page'],
    ['colorBgContainer', '--surface'],
    ['colorBgElevated', '--surface-raised'],
    ['colorBorder', '--border'],
    ['colorBorderSecondary', '--border-soft'],
    ['colorText', '--text'],
    ['colorTextSecondary', '--text-muted'],
    ['colorTextPlaceholder', '--text-muted'],
    ['colorTextDisabled', '--text-faint'],
    ['colorBgContainerDisabled', '--surface-hover'],
    ['colorError', '--danger'],
    ['colorSuccess', '--success'],
    ['colorWarning', '--warning'],
  ];

  for (const mode of ['light', 'dark'] as const) {
    it(`${mode} theme matches the ${mode} palette block`, () => {
      const values = tokenOf(mode) as Record<string, string | number>;
      const source = mode === 'dark' ? dark : light;
      for (const [key, prop] of PAIRS) {
        expect(values[key], `${key} vs ${prop}`).toBe(source[prop]);
      }
    });
  }

  it('secondary/tertiary text tones stay on --text-muted', () => {
    for (const mode of ['light', 'dark'] as const) {
      const values = tokenOf(mode) as Record<string, string>;
      const source = mode === 'dark' ? dark : light;
      expect(values.colorTextTertiary).toBe(source['--text-muted']);
    }
  });
});

describe('antdTokens ↔ tokens.css scales', () => {
  it('fontFamily is the exact --font-ui string', () => {
    expect(FONT_FAMILY).toBe(tokens['--font-ui']);
  });

  it('control heights are the --control-* ladder', () => {
    const light = tokenOf('light') as Record<string, number>;
    expect(light.controlHeight).toBe(38);
    expect(light.controlHeightSM).toBe(28);
    expect(light.controlHeightLG).toBe(46);
  });

  it('radius ladder is 2/4/8 like --radius-xs/sm/lg', () => {
    const light = tokenOf('light') as Record<string, number>;
    expect(light.borderRadiusSM).toBe(2);
    expect(light.borderRadius).toBe(4);
    expect(light.borderRadiusLG).toBe(8);
  });
});

describe('antdTokens stays on the five-rung type scale', () => {
  const SCALE = [12, 14, 16, 20, 28];

  for (const mode of ['light', 'dark'] as const) {
    it(`${mode} font tokens are all on the scale`, () => {
      const values = tokenOf(mode) as Record<string, number>;
      const fontTokens = [
        'fontSizeSM',
        'fontSize',
        'fontSizeLG',
        'fontSizeXL',
        'fontSizeHeading1',
        'fontSizeHeading2',
        'fontSizeHeading3',
        'fontSizeHeading4',
        'fontSizeHeading5',
      ];
      for (const name of fontTokens) {
        expect(SCALE, `${name}=${values[name]}`).toContain(values[name]);
      }
    });
  }
});
