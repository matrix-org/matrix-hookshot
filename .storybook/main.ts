import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";

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
      },
      optimizeDeps: {
        // Compound Web imports this CommonJS package as an ES default.
        include: ["classnames"],
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
