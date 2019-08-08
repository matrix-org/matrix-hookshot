matrix-github
=============

[![#github-bridge:half-shot.uk](https://img.shields.io/matrix/github-bridge:half-shot.uk.svg?server_fqdn=matrix.half-shot.uk&label=%23github-bridge:half-shot.uk&logo=matrix)](https://matrix.to/#/#github-bridge:half-shot.uk)


This bridge enables users to join Github issues and PRs through Matrix and collaborate using rooms.

## Setup

To set up the bridge, simply clone this repository.

` git clone git@github.com:Half-Shot/matrix-github.git`

then you will need to install dependencies

```bash
cd matrix-github
npm i # Or "yarn"
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
## Contact

TODO...