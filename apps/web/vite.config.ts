import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      /**
       * `prompt`, not `autoUpdate`: reloading the app mid-assessment to install
       * a new version would be hostile. The user is told an update is ready and
       * chooses when to take it.
       */
      manifest: {
        name: 'Community Health Centre Platform',
        short_name: 'CHC',
        description: 'Field assessment, evidence and facility management',
        theme_color: '#0f766e',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2}'],
        navigateFallback: '/index.html',
        /**
         * API responses are NEVER cached by the service worker.
         *
         * Patient and assessment data live in the encrypted IndexedDB store,
         * where they are protected and explicitly labelled with their age. A
         * service-worker cache would put them in plaintext on disk and hand
         * back stale figures with no "as of" timestamp attached.
         */
        runtimeCaching: [
          {
            urlPattern: /^https?:\/\/[^/]+\/api\//,
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: process.env['VITE_API_TARGET'] ?? 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  /**
   * `preview` needs its own proxy: it does not inherit the dev server's, and
   * the end-to-end suite runs against the built bundle rather than the dev one
   * — which is the version that actually ships.
   */
  preview: {
    host: '127.0.0.1',
    port: 4173,
    proxy: {
      '/api': {
        target: process.env['VITE_API_TARGET'] ?? 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        /**
         * Route-level splitting is mandatory (doc 05 §5): a CHEW on a 3G link
         * must never download the finance or analytics bundles.
         */
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
          query: ['@tanstack/react-query'],
          offline: ['dexie'],
        },
      },
    },
  },
});
