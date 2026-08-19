import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'

// dist 内存在受本机 safe-delete 拦截器保护的 mp4（deep-space-compute-field.mp4），
// Vite 默认的 emptyOutDir 会尝试删除它而被拦截，导致 build 中断。
// 这里关闭 Vite 自带的清空，改为在 buildStart 阶段手动清理 dist，
// 但跳过 .mp4 文件（由 Vite 从 public 覆盖写入，无需删除）。
function cleanDistExceptMp4() {
  return {
    name: 'clean-dist-except-mp4',
    buildStart() {
      const outDir = path.resolve(__dirname, 'dist')
      if (!fs.existsSync(outDir)) return
      for (const entry of fs.readdirSync(outDir)) {
        if (entry.toLowerCase().endsWith('.mp4')) continue
        fs.rmSync(path.join(outDir, entry), { recursive: true, force: true })
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), cleanDistExceptMp4()],
  build: {
    // 关闭 Vite 自带清空，避免触发 safe-delete 拦截器删除受保护的 mp4
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
