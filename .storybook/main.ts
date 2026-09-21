import { createRequire } from "node:module";
import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";

const require = createRequire(import.meta.url);

const config = {
  stories: [
    "../modules/**/*.stories.@(ts|tsx|mdx)",
    "../web/**/*.stories.@(ts|tsx|mdx)",
  ],
  framework: "@storybook/react-vite",
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  viteFinal: async (viteConfig) =>
    mergeConfig(viteConfig, {
      resolve: {
        // The module and Storybook must share the same React runtime.
        dedupe: ["react", "react-dom"],
        // The repository's application Vite config aliases React to Preact.
        // Shared Components uses React 19 internals, so Storybook must resolve
        // these imports to the actual React packages instead.
        alias: [
          {
            find: "react/jsx-runtime",
            replacement: require.resolve("react/jsx-runtime"),
          },
          {
            find: "react/jsx-dev-runtime",
            replacement: require.resolve("react/jsx-dev-runtime"),
          },
          {
            find: "react-dom/test-utils",
            replacement: require.resolve("react-dom/test-utils"),
          },
          {
            find: "react-dom",
            replacement: require.resolve("react-dom"),
          },
          { find: "react", replacement: require.resolve("react") },
        ],
      },
      optimizeDeps: {
        // Compound Web imports this CommonJS package as an ES default.
        include: ["classnames"],
      },
      // web-shared-components contains a few Node-compatible process checks.
      // Storybook runs in the browser, so provide the same static replacement
      // as the OpenProject module build.
      define: {
        "process.env.NODE_ENV": JSON.stringify("development"),
        process: { env: { NODE_ENV: "development" } },
      },
      css: {
        preprocessorOptions: {
          scss: {
            api: "modern",
          },
        },
      },
    }),
} satisfies StorybookConfig;

export default config;
