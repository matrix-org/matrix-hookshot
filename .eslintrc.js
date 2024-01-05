module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    plugins: [
        '@typescript-eslint'
    ],
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
    ],
    // eslint-config-preact needs a Jest version to be happy, even if Jest isn't used.
    // See https://github.com/preactjs/eslint-config-preact/issues/19#issuecomment-997924892
    settings: {
        jest: { "version": 27 },
    },
    rules: {
        "@typescript-eslint/explicit-module-boundary-types": "off",
        "@typescript-eslint/no-explicit-any": "warn",
        "@typescript-eslint/no-unused-vars": "warn",
        "camelcase": ["error", { "properties": "never", "ignoreDestructuring": true }],
        "no-console": "error"
    },
    env: {
        node: true,
        es6: true,
    },
    overrides: [
        {
            files: ["test/**/*.ts"],
            parser: '@typescript-eslint/parser',
            plugins: [
                '@typescript-eslint',
                'mocha',
            ],
        },
        {
            files: ["web/**/*.ts", "web/**/*.tsx"],
            parser: '@typescript-eslint/parser',
            env: {
                browser: true,
                node: false,
            },
            extends: [
                'plugin:@typescript-eslint/recommended',
                'preact',
            ],
            plugins: [
                '@typescript-eslint',
            ],
            rules: {
                "no-console": "off",
                "no-unused-vars": "off",
                "@typescript-eslint/no-explicit-any": "warn",
                "@typescript-eslint/no-unused-vars": ["error"],
                "no-useless-constructor": "off",
                "@typescript-eslint/no-useless-constructor": ["error"],
            },
        }
    ]
};