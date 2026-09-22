import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error Build-only ESM plugin is not part of the SDK declarations.
import { bundleEvidencePlugin } from './scripts/bundle-evidence.mjs';
// @ts-expect-error Build-only ESM plugin is not part of the SDK declarations.
import { productBuildPlugin } from './scripts/product-build.mjs';
export default defineConfig({
  plugins: [react(), productBuildPlugin(), bundleEvidencePlugin()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    minify: 'esbuild',
    rollupOptions: { external: [], output: { intro: '/* Lumina JavaScript Report SDK */' } },
    outDir: 'dist/sdk',
    lib: { entry: 'src/sdk/index.tsx', formats: ['es'], fileName: 'lumina', cssFileName: 'lumina' },
  },
});
