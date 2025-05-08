/// <reference types="vitest/config" />

// Configure Vitest (https://vitest.dev/config/)

import { defineConfig } from 'vite'

export default defineConfig({
  test: {
    /* for example, use global to avoid globals imports (describe, test, expect): */
    // globals: true,
    typecheck: {
      enabled: true,
    },
    retry: process.env.CI ? 3 : 1,
    include: ['spec/*.spec.ts'],
  },
})
