import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    minify: 'esbuild',
    rollupOptions: { external: [], output: { intro: '/* Lumina JavaScript Report SDK */' } },
    outDir: 'dist/sdk',
    lib: { entry: 'src/sdk/index.tsx', formats: ['es'], fileName: 'lumina', cssFileName: 'lumina' },
  },
});
