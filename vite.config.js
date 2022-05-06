import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [preact()],
  root: 'web',
  base: '/widgetapi/v1/static/',
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
})
