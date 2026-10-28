import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Consume the shared package from source so web and api always agree.
      '@processhub/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: false } },
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          antd: ['antd', '@ant-design/icons'],
          bpmn: ['bpmn-js/lib/Modeler', 'bpmn-js/lib/NavigatedViewer'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // The mini-map's CommonJS build does not load in Node; use its ES module build.
    alias: [{ find: /^diagram-js-minimap$/, replacement: 'diagram-js-minimap/dist/index.esm.js' }],
    server: { deps: { inline: ['diagram-js-minimap'] } },
    css: false,
  },
});
