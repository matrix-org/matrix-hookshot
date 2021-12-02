GitHub
======


## Features

## Configuration


### Creating a GitHub App

This bridge requires a [GitHub App](https://github.com/settings/apps/new). You will need to create one.

## Connecting a GitHub repository to a room

## Joining a dynamic GitHub room



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

Once that is setup, you will need to create a registration file for the bridge. 