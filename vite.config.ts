import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  clearScreen: false,
  build: {
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
});
