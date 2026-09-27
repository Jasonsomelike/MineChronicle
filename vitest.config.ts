import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';

// Same stamp the app build bakes in (vite.config.ts), so modules that import
// src/lib/version.ts resolve under the test runner too.
const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
);

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: { include: ['src/**/*.test.ts'] },
});
