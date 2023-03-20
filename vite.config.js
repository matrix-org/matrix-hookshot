import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import svgLoader from 'vite-svg-loader'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [preact(), svgLoader({ defaultImport: 'url'})],
  root: 'web',
  base: '',
  build: {
    outDir: '../public',
    rollupOptions: {
      input: {
        main: resolve('web', 'index.html'),
        oauth: resolve('web', 'oauth.html'),
      }
    },
    emptyOutDir: true,
  },
})
