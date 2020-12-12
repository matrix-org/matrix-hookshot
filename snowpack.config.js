/** @type {import("snowpack").SnowpackUserConfig } */
module.exports = {
    mount: {
        "web/": '/',
    },
    plugins: [
        ['@snowpack/plugin-typescript', '--project tsconfig.web.json'],
        '@prefresh/snowpack',
    ],
    install: [
      /* ... */
    ],
    installOptions: {
        installTypes: true,
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
  