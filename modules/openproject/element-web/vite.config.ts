import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import externalGlobals from "rollup-plugin-external-globals";

export default defineConfig({
  build: {
    lib: {
      entry: resolve("src/index.tsx"),
      name: "hookshotOpenProjectElementWeb",
      fileName: "index",
      formats: ["es"],
    },
    outDir: "lib",
    target: "esnext",
    sourcemap: true,
    rollupOptions: {
      // Keep React itself host-provided, while bundling react/jsx-runtime
      // used by Compound Web so the module has no bare browser imports.
      external: ["react"],
    },
  },
  plugins: [
    // Use the classic runtime so the generated module can use Element Web's
    // global React instance without a browser-resolved bare import for
    // react/jsx-runtime.
    react({ jsxRuntime: "classic" }),
    externalGlobals({
      // Reuse React from the Element Web host.
      react: "window.React",
    }),
  ],
  define: {
    "process.env.NODE_ENV": "'production'",
    process: { env: { NODE_ENV: "production" } },
  },
});
