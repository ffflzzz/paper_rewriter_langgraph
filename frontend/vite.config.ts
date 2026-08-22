import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 开发模式：/api 代理到 FastAPI 后端；生产模式：构建产物由 FastAPI 同源托管
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8765',
        changeOrigin: true,
      },
    },
  },
})
