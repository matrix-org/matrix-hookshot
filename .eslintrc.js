module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    plugins: [
        '@typescript-eslint',
        'mocha'
    ],
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
    ],
    rules: {
        "@typescript-eslint/explicit-module-boundary-types": "off",
        "camelcase": ["error", { "properties": "never", "ignoreDestructuring": true }],
    },
    "env": {
        "node": true,
        "es6": true,
    },
};