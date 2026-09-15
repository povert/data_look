import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import fs from 'node:fs'
import path from 'node:path'

// uTools 以本地文件协议加载 dist，带 crossorigin 的 script/link 会 CORS 失败 → 白屏
function stripCrossorigin() {
  return {
    name: 'strip-crossorigin',
    transformIndexHtml(html) {
      return html.replace(/\s+crossorigin(?:="[^"]*")?/gi, '')
    },
  }
}

// dist 不应带 development.main：否则 uTools 会去连 localhost:5173（未开 Vite 时白屏）
function stripDevMainFromDist() {
  return {
    name: 'strip-dev-main-from-dist',
    closeBundle() {
      const p = path.resolve(__dirname, 'dist/plugin.json')
      if (!fs.existsSync(p)) return
      try {
        const raw = fs.readFileSync(p, 'utf8')
        const j = JSON.parse(raw)
        if (j.development) {
          delete j.development
          fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n', 'utf8')
        }
      } catch { /* ignore */ }
    },
  }
}

/** uTools 打包禁止 .map / .js.gz 等调试文件；xlsx 等依赖会带上，构建后清掉 */
function cleanDebugFiles() {
  const banned = /\.(map|gz)$/i
  function walk(dir) {
    if (!fs.existsSync(dir)) return
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name)
      let st
      try { st = fs.statSync(full) } catch { continue }
      if (st.isDirectory()) walk(full)
      else if (banned.test(name)) {
        try { fs.unlinkSync(full) } catch { /* ignore */ }
      }
    }
  }
  return {
    name: 'clean-debug-files',
    closeBundle() {
      walk(path.resolve(__dirname, 'dist'))
    },
  }
}

export default defineConfig({
  plugins: [vue(), stripCrossorigin(), stripDevMainFromDist(), cleanDebugFiles()],
  base: './',
  build: {
    sourcemap: false,
  },
})

