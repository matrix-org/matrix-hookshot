Matrix Hookshot
===============

[![#hookshot:half-shot.uk](https://img.shields.io/matrix/hookshot:half-shot.uk.svg?server_fqdn=chaotic.half-shot.uk&label=%23hookshot:half-shot.uk&logo=matrix)](https://matrix.to/#/#hookshot:half-shot.uk)
[![Docker Image Version (latest by date)](https://img.shields.io/docker/v/halfshot/matrix-hookshot?sort=semver)](https://hub.docker.com/r/halfshot/matrix-hookshot)

A Matrix appservice which notifies you about changes on remote services, such as
GitHub, GitLab, JIRA and many more.

- Several services are supported out of the box.
- Can support **any** based sevice via [Generic Webhooks](https://matrix-org.github.io/matrix-hookshot/latest/setup/webhooks.html), with the ability to write rich templates using JavaScript.
- Requires **no external database** to run, using the homeserver as a persistent store.
- Supports End to Bridge encryption, allowing you to run and respond the bot in Matrix rooms.
- Backs Element's Extensions store, with [powerful widgets](https://matrix-org.github.io/matrix-hookshot/latest/advanced/widgets.html).

## Features

This bridge supports connecting to

- [Figma](https://matrix-org.github.io/matrix-hookshot/latest/setup/figma.html)
- [Generic Webhooks](https://matrix-org.github.io/matrix-hookshot/latest/setup/webhooks.html)
- [GitHub](https://matrix-org.github.io/matrix-hookshot/latest/setup/github.html)
- [GitLab](https://matrix-org.github.io/matrix-hookshot/latest/setup/gitlab.html)
- [Jira](https://matrix-org.github.io/matrix-hookshot/latest/setup/jira.html)
- [RSS/Atom feeds](https://matrix-org.github.io/matrix-hookshot/latest/setup/feeds.html)

Please read the [the setup guide](https://matrix-org.github.io/matrix-hookshot/latest/setup.html) for how to get
started.

## Documentation

Documentation can be found on [GitHub Pages](https://matrix-org.github.io/matrix-hookshot).

You can build the documentation yourself by:
```sh
# cargo install mdbook
mdbook build
sensible-browser book/index.html
```

## Contact

We have a Matrix support room ([#hookshot:half-shot.uk](https://matrix.to/#/#hookshot:half-shot.uk)).
