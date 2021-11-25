Provisioning API for matrix-hookshot
-----------------------------

# Overview

This document describes how to integrate with `matrix-hookshot`'s provisoning API.

Requests made to the bridge must be against the API listener defined in the config under `provisioning`, not
the appservice or webhook listeners.

Requests should always be authenticated with the secret given in the config, inside the `Authorization` header.
Requests being made on behalf of users (most provisioning APIs) should include the userId as a query parameter.

```
GET /v1/health?userId=%40Half-Shot%3Ahalf-shot.uk
Authorization: Bearer secret
```

APIs are versioned independently so two endpoints on the latest version may not always have the same version.

# APIs

## GET /v1/health

Request the status of the provisoning API.

### Response

```
HTTP 200
{}
```

Any other response should be considered a failed request (e.g. 404, 502 etc).

## GET /v1/{roomId}/connections

Request the connections for a given room. The `{roomId}` parameter is the target Matrix room, escaped.

### Response

```json5
[{
    "type": "GithubRepo",
    "service": "github", // or jira, webhook
    "details": {
        // ... connection details specific to the connection
    }
}]
```