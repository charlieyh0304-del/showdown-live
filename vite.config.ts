import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'path'

// 빌드 시마다 고유 버전 생성 (YYMMDDHHmm 형식)
const now = new Date()
const buildVersion = [
  String(now.getFullYear()).slice(2),
  String(now.getMonth() + 1).padStart(2, '0'),
  String(now.getDate()).padStart(2, '0'),
  String(now.getHours()).padStart(2, '0'),
  String(now.getMinutes()).padStart(2, '0'),
].join('')

export default defineConfig({
        base: process.env.DEPLOY_TARGET === 'github' ? '/showdown-live/' : '/',
  define: {
    __BUILD_VERSION__: JSON.stringify(buildVersion),
  },
  plugins: [
    {
      name: 'html-version-inject',
      transformIndexHtml(html) {
        return html.replace(/__APP_VERSION__/g, buildVersion)
      },
    },
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'robots.txt', 'icons/*.png'],
      devOptions: {
        enabled: false,
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        navigateFallback: null,
        globPatterns: ['**/*.{js,css,ico,png,svg,woff2}'],
        navigateFallbackDenylist: [/.*/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*firebaseio\.com/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'firebase-cache',
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 5, // 5 minutes for API data
              },
            },
          },
          {
            urlPattern: /^https:\/\/.*googleapis\.com/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-api-cache',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days for assets
              },
            },
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff2?)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'static-assets-cache',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days for static assets
              },
            },
          },
        ],
      },
      manifest: {
        name: '쇼다운',
        short_name: '쇼다운',
        description: '시각장애인 스포츠 쇼다운 경기 관리 앱',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@shared': resolve(__dirname, './src/shared'),
      '@app': resolve(__dirname, './src/app'),
      '@admin': resolve(__dirname, './src/admin'),
      '@referee': resolve(__dirname, './src/referee'),
      '@spectator': resolve(__dirname, './src/spectator'),
    },
  },
})
