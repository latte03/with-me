import { defineConfig } from 'vite'

declare const process: { env: Record<string, string | undefined> }

export default defineConfig({
  define: {
    // 出包时由 scripts/build-fpk.sh 注入 packaging/manifest 的版本；本地 dev/build 显示 dev
    __APP_VERSION__: JSON.stringify(process.env.VITE_APP_VERSION || 'dev'),
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
  build: {
    target: 'es2022',
  },
})
