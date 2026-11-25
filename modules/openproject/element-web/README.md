# OpenProject Element Web module

This package provides the OpenProject work-package message renderer for
Element Web runtime modules.

## Element Web compatibility

The module requires Element Web module API v2.6.0 or newer:

```text
^2.6.0
```

It is configured in
[`contrib/docker/element/config.json`](../../../contrib/docker/element/config.json)
and is loaded from:

```text
/modules/v1/static/openproject.js
```

## Build and deployment

Build the application and module together:

```sh
pnpm build
```

The module artifact will be published at:

```text
public/modules/openproject/element-web/index.js
```

## Configure for account connection

To show **Connect my account** on active OpenProject anchor cards, add the
selected bot and the trusted OpenProject origin to Element Web's configuration
under `org.matrix.matrix-hookshot`:

```json
{
  "org.matrix.matrix-hookshot": {
    "integrationBots": {
      "openproject": "@hookshot:example.org"
    },
    "openProjectBaseUrl": "https://projects.example.org"
  }
}
```
