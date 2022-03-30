matrix-hookshot
===============

*Previously matrix-github*

[![#hookshot:half-shot.uk](https://img.shields.io/matrix/hookshot:half-shot.uk.svg?server_fqdn=chaotic.half-shot.uk&label=%23hookshot:half-shot.uk&logo=matrix)](https://matrix.to/#/#hookshot:half-shot.uk)
[![Docker Image Version (latest by date)](https://img.shields.io/docker/v/halfshot/matrix-hookshot?sort=semver)](https://hub.docker.com/r/halfshot/matrix-hookshot)

A bridge between Matrix and multiple project management services, such as GitHub, GitLab and JIRA.

## Featureset

This bridge supports:
- Figma
  - File comments
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

[See the setup guide](https://matrix-org.github.io/matrix-hookshot/latest/setup.html)

## Documentation

Documentation can be found on [GitHub Pages](https://matrix-org.github.io/matrix-hookshot).

You can build the documentaion yourself by:
```sh
# cargo install mdbook
mdbook build
sensible-browser book/index.html
```

## Contact

We have a bridge support room you can drop into at [#hookshot:half-shot.uk](https://matrix.to/#/#hookshot:half-shot.uk), or you can reach me at [@Half-Shot:half-shot.uk](https://matrix.to/#/@Half-Shot:half-shot.uk)
