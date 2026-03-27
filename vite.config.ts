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
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'robots.txt', 'icons/*.png'],
      devOptions: {
        enabled: false,
      },
      injectManifest: {
        globPatterns: ['**/*.{ico,png,svg,woff2}'],
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
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/database', 'firebase/auth'],
          'firebase-messaging': ['firebase/messaging'],
          react: ['react', 'react-dom', 'react-router-dom'],
          i18n: ['i18next', 'react-i18next'],
        },
      },
    },
  },
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
