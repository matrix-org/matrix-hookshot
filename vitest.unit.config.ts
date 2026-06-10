/// <reference types="vitest/config" />

import { defineConfig } from 'vite'

export default defineConfig({
  test: {
    setupFiles: ['tests/setup.ts'],
    typecheck: {
      enabled: true,
    },
    include: ['tests/**/*.spec.ts'],
  },
})
