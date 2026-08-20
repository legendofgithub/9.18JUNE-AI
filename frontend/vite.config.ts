import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // 关闭自动清空：dist 内存在受 safe-delete 拦截器保护的 mp4，
    // Vite 清空会触发拦截导致 build 中断。改为增量覆盖写入。
    emptyOutDir: false,
  },
  server: {
    port: 5173,
    strictPort: true,
    open: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
