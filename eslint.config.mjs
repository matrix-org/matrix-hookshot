import mocha from "eslint-plugin-mocha";
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from "eslint-plugin-react";
import chai from "eslint-plugin-chai-expect";

export default [
    {
        ignores: ["lib/**/*", "spec-lib/**/*", "contrib/**/*"],
    },
    ...tseslint.config(
        {
            files:  ["src/**/*.ts", "scripts/*.ts"],
            extends: [
                eslint.configs.recommended,
                ...tseslint.configs.recommended,
            ],
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
        {
            files:  ["tests/**/*.ts", "tests/**/*.spec.ts"],
            extends: [
                eslint.configs.recommended,
                ...tseslint.configs.recommended,
                mocha.configs.flat.recommended,
                chai.configs["recommended-flat"],
            ],
            rules: {
                "@typescript-eslint/explicit-module-boundary-types": "off",
                "@typescript-eslint/no-explicit-any": "warn",
                "@typescript-eslint/no-unused-vars": "warn",
                // Chai assertions don't call functions
                "@typescript-eslint/no-unused-expressions": "off",
                camelcase: ["error", {
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
        {
            settings: {
                react: {
                    pragma: "Preact",
                    version: "17",
                }
            },
            files:  ["web/**/*.ts", "web/**/*.tsx"],
            extends: [
                eslint.configs.recommended,
                ...tseslint.configs.recommended,
                react.configs.flat.recommended,
                react.configs.flat['jsx-runtime'],
            ],
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
        },
    ),
];