import type { ArgTypes, Decorator, Preview } from "@storybook/react-vite";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import React, { useLayoutEffect } from "react";
import "./app-web-root.css";
import "./preview.css";

export const globalTypes = {
  theme: {
    name: "Theme",
    description: "Global Compound theme for components",
    toolbar: {
      icon: "circlehollow",
      title: "Theme",
      items: [
        { title: "System", value: "system", icon: "browser" },
        { title: "Light", value: "light", icon: "sun" },
        { title: "Light (high contrast)", value: "light-hc", icon: "sun" },
        { title: "Dark", value: "dark", icon: "moon" },
        { title: "Dark (high contrast)", value: "dark-hc", icon: "moon" },
      ],
    },
  },
  rootCss: {
    name: "Root CSS",
    description: "Element Web default CSS overrides",
    toolbar: {
      icon: "paintbrush",
      title: "Root CSS",
      items: [
        { title: "Default", value: "storybook" },
        { title: "Element Web", value: "app-web" },
      ],
    },
  },
} satisfies ArgTypes;

const allThemeClasses = globalTypes.theme.toolbar.items.map(
  ({ value }) => `cpd-theme-${value}`,
);

const RootCssSwitcher: React.FC<{ rootCss: string }> = ({ rootCss }) => {
  useLayoutEffect(() => {
    if (rootCss === "app-web") {
      document.documentElement.dataset.storybookRootCss = rootCss;
    } else {
      delete document.documentElement.dataset.storybookRootCss;
    }

    return () => {
      delete document.documentElement.dataset.storybookRootCss;
    };
  }, [rootCss]);

  return null;
};

const ThemeSwitcher: React.FC<{ theme: string }> = ({ theme }) => {
  useLayoutEffect(() => {
    document.body.classList.remove(...allThemeClasses);

    if (theme !== "system") {
      document.body.classList.add(`cpd-theme-${theme}`);
    }

    return () => document.body.classList.remove(...allThemeClasses);
  }, [theme]);

  return null;
};

const withThemeProvider: Decorator = (Story, context) => (
  <>
    <ThemeSwitcher theme={context.globals.theme ?? "system"} />
    <Story />
  </>
);

const withRootCss: Decorator = (Story, context) => (
  <>
    <RootCssSwitcher rootCss={context.globals.rootCss ?? "storybook"} />
    <Story />
  </>
);

const preview: Preview = {
  initialGlobals: {
    theme: "light",
    rootCss: "storybook",
  },
  decorators: [withRootCss, withThemeProvider],
  parameters: {
    layout: "padded",
    controls: {
      expanded: true,
    },
    a11y: {
      test: "todo",
    },
  },
};

export default preview;
