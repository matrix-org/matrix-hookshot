/** @type {import("snowpack").SnowpackUserConfig } */
module.exports = {
    mount: {
        "web/": '/'
    },
    plugins: [
      '@prefresh/snowpack',
      '@snowpack/plugin-sass',
      ['@snowpack/plugin-typescript', '--project tsconfig.web.json'],
    ],
    packageOptions: {
        installTypes: true,
        polyfillNode: true,
    },
    buildOptions: {
        out: 'public'
    },
  };
  