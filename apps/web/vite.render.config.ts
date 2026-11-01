import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

/**
 * Build of the server-side diagram renderer page (D-172): `render.html` + its assets in
 * `dist-render/`, loaded by the `renderer` container from disk (no network). The manifest tells the
 * renderer which CSS files hold the fonts (used for HTML → PDF too).
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@processhub/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  build: {
    outDir: 'dist-render',
    emptyOutDir: true,
    manifest: true,
    chunkSizeWarningLimit: 4000,
    rollupOptions: { input: fileURLToPath(new URL('./render.html', import.meta.url)) },
  },
});
