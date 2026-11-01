import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Preloads the two regular-weight fonts of the first screen (Inter Latin, IBM Plex Sans Arabic)
 * so text does not wait for the CSS before the font download starts (final session, part A).
 */
function preloadFonts(): Plugin {
  const wanted = [
    /inter-latin-400-normal-[\w-]+\.woff2$/,
    /ibm-plex-sans-arabic-arabic-400-normal-[\w-]+\.woff2$/,
  ];
  return {
    name: 'processhub-preload-fonts',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const files = Object.keys(ctx.bundle ?? {}).filter((f) => wanted.some((w) => w.test(f)));
        return files.map((f) => ({
          tag: 'link',
          attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: `/${f}`, crossorigin: '' },
          injectTo: 'head' as const,
        }));
      },
    },
  };
}
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), preloadFonts()],
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
        // Only React is a fixed vendor chunk (needed by every screen, rarely changes). Everything
        // else — Ant Design per component, bpmn-js, charts, dmn-js, TipTap — is split by the
        // bundler along the route chunks of App.tsx, so a screen loads only what it uses. Fixed
        // groups for those libraries pulled their shared helpers into the entry (final session A).
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
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
