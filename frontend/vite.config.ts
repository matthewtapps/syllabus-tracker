import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { visualizer } from "rollup-plugin-visualizer";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Opt-in bundle map. Run `pnpm analyze` to produce dist/stats.html and
    // see which chunks dominate the build. Spread keeps the array type
    // homogeneous, avoiding the rollup version mismatch between vite's
    // rollup and rollup-plugin-visualizer's rollup.
    ...(process.env.ANALYZE
      ? [
          visualizer({
            filename: "dist/stats.html",
            open: true,
            gzipSize: true,
            brotliSize: true,
          }),
        ]
      : []),
    VitePWA({
      registerType: "prompt",
      includeAssets: [
        "favicon/favicon.ico",
        "favicon/favicon-32x32.png",
        "icons/apple-touch-icon.png",
      ],
      manifest: {
        name: "Silly Bus App",
        short_name: "Silly Bus",
        description: "Track your jiu-jitsu syllabus progress.",
        theme_color: "#1f1f1f",
        background_color: "#1f1f1f",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "icons/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Precache only the HTML shell + critical static assets. Route JS
        // chunks are runtime-cached on first navigation (StaleWhileRevalidate
        // below). With every page lazy-loaded, precaching every chunk would
        // re-download the entire app on first install.
        globPatterns: [
          "index.html",
          "assets/**/*.css",
          "manifest.webmanifest",
          "**/*.{ico,png,svg,woff,woff2}",
        ],
        navigateFallback: "/index.html",
        // Don't intercept API calls or the SPA's auth redirects.
        navigateFallbackDenylist: [/^\/api/],
        // Evict the previous build's precache entries once the new SW activates.
        // Without this, stale hashed assets linger in CacheStorage forever.
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
          },
          {
            // Route chunks (hashed filenames). Serve from cache if present
            // for offline-friendly returning visits; revalidate in the
            // background so the next nav picks up new builds.
            urlPattern: ({ url }) => /\/assets\/.*\.js$/.test(url.pathname),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "app-js",
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    manifest: true,
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
