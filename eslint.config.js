import js from '@eslint/js';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import hooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: [
      'dist',
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
    // Scripts that touch DOM/canvas APIs (Image, ImageData, document) on top of
    // Node. Only list the files that actually use them.
    files: [
      'scripts/stat-icon-renderer.mjs',
      'scripts/probe-gsap-stat-icons.mjs',
      'scripts/stat-entity-renderer.mjs',
      'scripts/visual-qa-full-report.mjs',
      'scripts/visual-qa-spider-ferro.mjs',
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
