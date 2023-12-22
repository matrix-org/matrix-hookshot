import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { resolve } from 'path'
import magicalSvg from 'vite-plugin-magical-svg'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [preact(), magicalSvg.default({
    // By default, the output will be a dom element (the <svg> you can use inside the webpage).
    // You can also change the output to react (or preact) to get a component you can use.
    target: 'preact',
    // By default, the svgs are optimized with svgo. You can disable this by setting this to false.
    svgo: true
  })],
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
