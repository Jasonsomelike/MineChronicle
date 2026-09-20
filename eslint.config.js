import js from '@eslint/js';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import hooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: [
      'dist',
      'output',
      'node_modules',
      'src-tauri/target',
      'src-tauri/gen',
      '.dependencies-interrupted',
      '.local',
    ],
  },
  js.configs.recommended,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    // Scripts whose code also runs inside the page: either DOM/canvas APIs
    // (Image, ImageData, document) or Playwright evaluate/addInitScript bodies
    // (window, localStorage). Only list the files that actually need it.
    files: [
      'scripts/stat-icon-renderer.mjs',
      'scripts/stat-entity-renderer.mjs',
      'scripts/visual-qa-full-report.mjs',
      'scripts/visual-qa-spider-ferro.mjs',
      'scripts/qa-player-persistence.mjs',
      'scripts/visual-qa-box.mjs',
      'scripts/visual-qa-spider-color.mjs',
      'scripts/visual-qa-two-box.mjs',
      'scripts/oneoff/probe-gsap-stat-icons.mjs',
      'scripts/qa-visual-snapshot.mjs',
    ],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': hooks, '@typescript-eslint': tsPlugin },
    rules: {
      ...hooks.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
    },
  },
];
