/** @type {import("snowpack").SnowpackUserConfig } */
module.exports = {
    mount: {
        "web/": '/'
    },
    plugins: [
      '@prefresh/snowpack',
      ['@snowpack/plugin-typescript', '--project tsconfig.web.json'],
    ],
    install: [
      /* ... */
    ],
    installOptions: {
        installTypes: true,
        polyfillNode: true,
    },
    devOptions: {
      /* ... */
    },
    buildOptions: {
        out: 'public'
      /* ... */
    },
    proxy: {
      /* ... */
    },
    alias: {
      /* ... */
    },
  };
  