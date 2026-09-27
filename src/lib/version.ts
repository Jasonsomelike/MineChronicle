declare const __APP_VERSION__: string | undefined;

/* The stamp the frontend reports about itself. It is baked in by the bundler from
   package.json (vite.config.ts / vitest.config.ts `define`) instead of being a
   constant edited by hand: a release bumps the manifests once, and this stamp
   follows, so the mismatch check in scan.ts - which compares it against the Rust
   core's own version to catch a frontend bundle that does not belong to the binary
   it runs inside - trips on a real mixing of builds, never on a forgotten edit.
   The fallback only answers in a context neither config reaches. */
export const FRONTEND_VERSION =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';
