import mocha from "eslint-plugin-mocha";
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from "eslint-plugin-react";


export default [
    ...tseslint.config(
        eslint.configs.recommended,
        tseslint.configs.recommended,
        {
            files:  ["src/**/*.ts", "scripts/*.ts"],
            rules: {
                "@typescript-eslint/explicit-module-boundary-types": "off",
                "@typescript-eslint/no-explicit-any": "warn",
                "@typescript-eslint/no-unused-vars": "warn",
                camelcase: ["error", {
                    properties: "never",
                    ignoreDestructuring: true,
                }],
                "no-console": "error",
            },
        },
    ),
    ...tseslint.config(
        eslint.configs.recommended,
        tseslint.configs.recommended,
        mocha.configs.flat.recommended,
        {
            files:  ["test/**/*.ts"],
            rules: {
                "@typescript-eslint/explicit-module-boundary-types": "off",
                "@typescript-eslint/no-explicit-any": "warn",
                "@typescript-eslint/no-unused-vars": "warn",
                camelcase: ["always", {
                    properties: "never",
                    ignoreDestructuring: true,
                }],
                "no-console": "error",
                // Needs a refactor
                "mocha/no-mocha-arrows": "off",
            },
        },
    ),
    ...tseslint.config(
        eslint.configs.recommended,
        tseslint.configs.recommended,
        react.configs.flat.recommended,
        {
            files:  ["web/**/*.ts", "web/**/*.tsx"],
            rules: {
                "no-console": "off",
                "no-unused-vars": "off",
                "no-useless-constructor": "off",
                "@typescript-eslint/no-explicit-any": "warn",
                "@typescript-eslint/no-unused-vars": "error",
                "@typescript-eslint/no-useless-constructor": "error",
                "react/react-in-jsx-scope": "off",
                "react/prop-types": "off",
            },
            settings: {
                pragma: "Preact",
            },
        },
    ),
];