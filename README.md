matrix-hookshot
===============

*Previously matrix-github*

[![#hookshot:half-shot.uk](https://img.shields.io/matrix/github-bridge:half-shot.uk.svg?server_fqdn=chaotic.half-shot.uk&label=%23hookshot:half-shot.uk&logo=matrix)](https://matrix.to/#/#hookshot:half-shot.uk)
[![Docker Image Version (latest by date)](https://img.shields.io/docker/v/halfshot/matrix-hookshot)](https://hub.docker.com/r/halfshot/matrix-hookshot)

A bridge between Matrix and multiple project management services, such as GitHub, GitLab and JIRA.

## Featureset

This bridge bridges:

- GitHub
  - Webhooks (new issues, pull requests, releases etc)
  - Commands (create issues, assign issues, start workflows etc)
- GitLab
  - Webhooks (new issues, merge requests etc)
  - Commands
- Jira
  - Webhooks (new issues, issue changes)
  - Commands (create new issues)
- Generic webhooks
  - Webhooks (via GET, PUT or POST with optional transformation functions)

## Setup

[See the setup guide](https://half-shot.github.io/matrix-hookshot/setup.html)

This bridge requires at least Node 12, and Rust installed. If you do not have rust, https://rustup.rs/ is the quickest way to get it.

To set up the bridge, simply clone this repository.

` git clone git@github.com:Half-Shot/matrix-hookshot.git`

then you will need to install the dependencies

```sh
cd matrix-hookshot
yarn
```

Then you will need to copy the `config.sample.yml` to a new file called `config.yml`. You should fill this in. Pay **close** attention to settings like `passkey` which are required for the bridge to function.

For the GitHub tokens, you will need to create a new [GitHub App](https://github.com/settings/apps/new)

You will need to allow access to your bridge instance via a public URL, and fill in the Webhook URL option on GitHub. You will need to also generate a secret key which can be anything, but should be long and unique.

Additionally, you will need to setup some permissions in "Permissions & events".

Largely, these need to be:

- Repository contents: "Read & Write"
- Issues: "Read & Write"
- Pull-requests: "Read & Write"

You will also need to subscribe to, at a minimum:

- Issues
- Label
- Issue comment
- Pull request
- Pull request review
- Pull request review comment

Once that is setup, you will need to create a registration file for the bridge. Copy `registration.sample.yml` into `registration.yml` and fill in. You are nearly done! Copy or link the registration.yml file to your homeserver in some way, and reconfigure your homeserver to use it. Ensure you have restarted your homeserver if needed (Synapse needs this).

## Running

You can run `npm run start:app` to start the app.


## Running in multi-process mode.

If you are running as a non-monolith, then you should also run `npm run start:webhooks`. In the case of the latter, ensure a Redis instance is running. 

You can quickly setup a redis by either installing it from your system package manager, or just running

`docker run --name github-bridge-redis -p 6379:6379 -d redis`

in Docker.

## Documentation

Documentation can be found on [GitHub Pages](https://matrix-org.github.io/matrix-appservice-irc).

You can build the documentaion yourself by:
```sh
# cargo install mdbook
mdbook build
sensible-browser book/index.html
```

## Contact

TODO...