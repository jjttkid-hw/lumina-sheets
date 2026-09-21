import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error Build-only ESM plugin.
import { productBuildPlugin } from './scripts/product-build.mjs';
export default defineConfig({
  plugins: [react(), productBuildPlugin()],
  server: { host: '0.0.0.0', port: 5173 },
  build: { rollupOptions: { input: ['index.html', 'examples/report.html'] } },
});
