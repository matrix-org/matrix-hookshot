# OpenProject Element Web module

This package provides the OpenProject work-package message renderer for
Element Web runtime modules.

## Element Web compatibility

The module supports Element Web module API v2:

```text
^2.0.0
```

It is configured in
[`contrib/docker/element/config.json`](../../../contrib/docker/element/config.json)
and is loaded from:

```text
/modules/v2/static/openproject.js
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
