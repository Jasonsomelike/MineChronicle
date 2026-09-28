/**
 * The app's design tokens, restated for Ant Design.
 *
 * warmth.css owns the palette and tokens.css owns the scales; this module is the
 * bridge that hands the same values to antd's theme so the library renders from
 * one shared source of truth instead of growing a second palette. The two are
 * held together by `antdTokens.test.ts`, which parses warmth.css / tokens.css and
 * fails if the values here drift from them.
 *
 * Five-rung type ramp �?antd's font tokens (all overridable in v6, confirmed
 * against es/theme/interface/maps/font.d.ts):
 *   caption 12 �?fontSizeSM, body 14 �?fontSize, lead 16 �?fontSizeLG,
 *   heading 20 �?fontSizeXL, display 28 �?fontSizeHeading1/2.
 *
 * Dark mode uses `theme.darkAlgorithm` and overrides Map Tokens only: the
 * official guidance is to never set `colorBgBase` directly, so every surface
 * below is a named Map Token carried over from the dark block in warmth.css.
 * The dark primary keeps the light theme's #0F766E on purpose - the accent
 * greens that read well as dark-theme text (#7FD4C0) all measure under 3:1
 * under white, so the fill follows the same AA argument the blue palette made;
 * the reasoning lives in the warmth.css dark block.
 */

import { theme } from 'antd';
import type { ThemeConfig } from 'antd';

/** Same string as tokens.css `--font-ui`. Asserted by antdTokens.test.ts. */
export const FONT_FAMILY =
  "'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";

/** The body step over the body size - the ramp's own ratio (20/14), not a new number. */
const LINE_HEIGHT = 20 / 14;

/**
 * Control heights, from tokens.css: `--control-md` 38 / `--control-sm` 28 /
 * `--control-lg` 46. antd's defaults are 32/24/40, which would render a migrated
 * button visibly shorter than the hand-written controls beside it; with the seed
 * set to the app's own scale a Select and a native rail button in one row still
 * line up.
 */
const CONTROL_HEIGHT_MD = 38;
const CONTROL_HEIGHT_SM = 28;
const CONTROL_HEIGHT_LG = 46;

/** The five rungs, in antd's vocabulary. [12, 14, 16, 20, 28] - nothing else. */
const TYPE_TOKENS = {
  fontSizeSM: 12,
  fontSize: 14,
  fontSizeLG: 16,
  fontSizeXL: 20,
  fontSizeHeading1: 28,
  fontSizeHeading2: 28,
  fontSizeHeading3: 20,
  fontSizeHeading4: 20,
  fontSizeHeading5: 16,
  lineHeight: LINE_HEIGHT,
} as const;

/** Arco's radius ladder, matching tokens.css --radius-xs/sm/md/lg = 2/4/8/8. */
const RADIUS_TOKENS = {
  borderRadiusXS: 2,
  borderRadiusSM: 2,
  borderRadius: 4,
  borderRadiusLG: 8,
} as const;

const LIGHT: ThemeConfig = {
  cssVar: {}, // v6 does not enable CSS variables by default; the object form is its only shape.
  token: {
    fontFamily: FONT_FAMILY,
    ...TYPE_TOKENS,
    controlHeight: CONTROL_HEIGHT_MD,
    controlHeightSM: CONTROL_HEIGHT_SM,
    controlHeightLG: CONTROL_HEIGHT_LG,
    ...RADIUS_TOKENS,
    colorPrimary: '#0f766e',
    colorInfo: '#0f766e',
    colorLink: '#0f766e',
    colorError: '#cb272d',
    colorSuccess: '#008026',
    colorWarning: '#a64500',
    colorBgLayout: '#f7f8fa',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorBorder: '#e5e6eb',
    colorBorderSecondary: '#f2f3f5',
    colorText: '#1d2129',
    colorTextSecondary: '#4e5969',
    colorTextTertiary: '#4e5969',
    /* The placeholder tone is --text-muted: the hand-written fields measured
       7.10:1 with it, and antd's 25%-alpha placeholder fails AA (1.83:1,
       caught by scripts/qa-design-check.mjs on the settings page). */
    colorTextPlaceholder: '#4e5969',
    /* The app's measured disabled pair (styles.css `button:disabled`): the
       control stops being filled, the label stays readable (6.12:1 on the
       fill). antd's own defaults fade the text below the gate's 4.5:1 bar. */
    colorTextDisabled: '#4e5969',
    colorBgContainerDisabled: '#f2f3f5',
  },
};

const DARK: ThemeConfig = {
  cssVar: {},
  algorithm: theme.darkAlgorithm,
  /* Component-level overrides, per the gate's escalation order (components
     tokens first, never silent relaxations). In dark mode antd paints several
     *selected* control texts with colorPrimary - and the AA-motivated choice to
     keep #0F766E as the dark fill color (white on it: 5.47:1) makes that pine
     unreadable as text on dark surfaces (measured 2.87:1 on #17171A by
     scripts/qa-design-check.mjs). warmth.css solved the same pair with
     --text-accent #7FD4C0, so the components here paint selected/hover states
     from that accent family. Light mode needs no override: #0F766E text on
     white measures 5.47:1. */
  components: {
    Tabs: {
      itemSelectedColor: '#7fd4c0', // --text-accent, dark block
      itemHoverColor: '#a3e4d4', // one step lighter than the accent
      itemActiveColor: '#b8ecdf', // pressed step
    },
  },
  token: {
    fontFamily: FONT_FAMILY,
    ...TYPE_TOKENS,
    controlHeight: CONTROL_HEIGHT_MD,
    controlHeightSM: CONTROL_HEIGHT_SM,
    controlHeightLG: CONTROL_HEIGHT_LG,
    ...RADIUS_TOKENS,
    // See the module comment: AA keeps the light primary in dark mode.
    colorPrimary: '#0f766e',
    colorInfo: '#0f766e',
    colorLink: '#7fd4c0',
    colorError: '#f98d86',
    colorSuccess: '#27c346',
    colorWarning: '#ff9626',
    colorBgLayout: '#17171a',
    colorBgContainer: '#232324',
    colorBgElevated: '#2a2a2b',
    colorBorder: '#333335',
    colorBorderSecondary: '#2a2a2b',
    colorText: 'rgba(255, 255, 255, 0.9)',
    colorTextSecondary: 'rgba(255, 255, 255, 0.7)',
    colorTextTertiary: 'rgba(255, 255, 255, 0.7)',
    colorTextPlaceholder: 'rgba(255, 255, 255, 0.7)',
    colorTextDisabled: 'rgba(255, 255, 255, 0.7)',
    colorBgContainerDisabled: '#2e2e30',
  },
};

/** The antd theme for one resolved palette. Pure - no DOM reads. */
export function themeFor(mode: 'light' | 'dark'): ThemeConfig {
  return mode === 'dark' ? DARK : LIGHT;
}
