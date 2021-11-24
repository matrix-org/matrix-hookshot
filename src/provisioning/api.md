Provisioning API for matrix-hookshot
-----------------------------

# Overview

This document describes how to integrate with `matrix-hookshot`'s provisoning API.

Requests made to the bridge must be against the API listener defined in the config under `provisioning`, not
the appservice or webhook listeners.

Requests should always be authenticated with the secret given in the config, inside the `Authorization` header.

```
GET /v1/health
Authorization: Bearer secret
```

APIs are versioned independently so two endpoints on the latest version may not always have the same version.

# APIs

## /api/v1/health

Request the status of the provisoning API.

### Response

A successful request will result in:

```
HTTP 200
{}
```

Any other response should be considered a failed request (e.g. 404, 502 etc).