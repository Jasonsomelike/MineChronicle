import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { existsSync, readFileSync } from 'node:fs';

// The frontend's version stamp is the package's own version, baked in at build
// time (see src/lib/version.ts): a release bumps the manifests, and the stamp
// follows - there is no fifth place to forget.
const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
);

export default defineConfig(({ command }) => {
  const iconBuildPath = new URL(
    './.local/stat-icon-build.json',
    import.meta.url,
  );
  const iconBuild =
    command === 'build' && existsSync(iconBuildPath)
      ? JSON.parse(readFileSync(iconBuildPath, 'utf8'))
      : { format: 'png' };

  return {
    plugins: [react(), tailwindcss()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __STAT_ICON_EXTENSION__: JSON.stringify(
        iconBuild.format === 'webp' ? 'webp' : 'png',
      ),
      __STAT_ICON_PNG_FILES__: JSON.stringify(
        iconBuild.format === 'webp' ? iconBuild.pngFiles ?? [] : [],
      ),
    },
    server: {
      port: 1420,
      strictPort: true,
      watch: { ignored: ['**/src-tauri/**'] },
    },
    clearScreen: false,
    build: {
      copyPublicDir: false,
      rollupOptions: {
        output: {
          // The library is the heaviest part of the dependency tree; its own
          // chunk keeps the app's first-frame cost from growing with it.
          // Vite 8's typing only takes the function form.
          manualChunks(id: string) {
            if (
              id.includes('node_modules') &&
              /node_modules[\\/](antd|dayjs|@ant-design|@rc-component)[\\/]/.test(
                id,
              )
            ) {
              return 'antd';
            }
            return undefined;
          },
        },
      },
    },
  };
});
