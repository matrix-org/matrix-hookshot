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
    // Must exceed WAIT_EVENT_TIMEOUT in spec/util/e2e-test.ts, so that the
    // helpers' descriptive "Timed out waiting for ..." error surfaces rather
    // than vitest's generic "Test timed out in Xms".
    testTimeout: 30000,
    include: ['spec/*.spec.ts'],
  },
})
