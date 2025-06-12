# Setting up a developer environment

Getting started with Hookshot development is pretty easy! If you are familiar with Matrix server managmenet, and specifically integration
development then you will probably be quite comfortable just using our [standard install process](https://matrix-org.github.io/matrix-hookshot/latest/setup.html#local-installation).

If you are less familar, then we have a [Docker Compose](https://docs.docker.com/compose/) setup that requires very minimal effort to get going.

## Local installation (on host)

Follow the [local install process](https://matrix-org.github.io/matrix-hookshot/latest/setup.html#local-installation), and the [configuration guide](https://matrix-org.github.io/matrix-hookshot/latest/setup.html#configuration).

Once that's done, make changes at will and simply run `yarn build` and then `yarn start` to run your new changes.

Keep in mind that the widgets feature does federated lookups, which do not work well over HTTP / `localhost`. To get around this, include the follwing
in your config file:

```yml
widgets:
  # ...
  openIdOverrides:
    "localhost": "http://your-synapse-listener"
```

Hookshot will warn and generally get a bit fussy in the logs, but you can ignore it in the safe knowledge you are not using this
in production.

## Docker Compose

The only hard requirements for this process are that you have Docker compose installed. 

The steps to a complete test environment are as follows:

 - Checkout the project repository from https://github.com/matrix-org/matrix-hookshot.
 - Create an empty `config.yml` file in the root of your checkout.
 - Run `docker compose up`. This may take some time for all the images to be present.
 - Go to `http://localhost:8083` and register a new user.
 - Create a new room, invite `@hookshot:localhost`.
 - Promote it to Moderator as requested.
 - Go to the Hookshot widget (under extensions) to configure a webhook.

This gives you a very basic experience, but we can configure this further. You can extend the config.yml with any of the options in [the sample config](../setup/sample-configuration). Keep in mind certain configuration options are pre-filled to ensure compatibility in the Docker environment. To override those settings
you will need to copy the appropirate configuration block from `contrib/docker/config.yaml`.

### CA Certificates for developing against local HTTPS services

If you prefer to develop against services that require adding a CA file, you can follow the [official advice](https://docs.docker.com/engine/network/ca-certs/#add-certificates-to-images) which works for the Hookshot image. 

