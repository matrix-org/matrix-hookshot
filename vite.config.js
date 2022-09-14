import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import svgLoader from 'vite-svg-loader'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [preact(), svgLoader({ defaultImport: 'url'})],
  root: 'web',
  base: '',
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
})
