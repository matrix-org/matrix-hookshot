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

Request the connections for a given room. The `{roomId}` parameter is the target Matrix room.

### Response

```json5
[{
    "type": "uk.half-shot.matrix-hookshot.jira.project", // Corresponds to the state type in the connection
    "id": "opaque-unique-id", // An opaque ID used to refer to this connection. Should **NOT** be assumed to be stable.
    "service": "jira", // or github, webhook. A human-readable service name to make things look pretty
    "details": {
        // ... connection specific details, can be configured.
    }
}]
```

## GET /v1/{roomId}/connections/{id}

Request details of a single connection. The `{roomId}` parameter is the target Matrix room.

### Response

```json5
{
    "type": "uk.half-shot.matrix-hookshot.jira.project", // Corresponds to the state type in the connection
    "id": "opaque-unique-id", // An opaque ID used to refer to this connection. Should **NOT** be assumed to be stable.
    "service": "jira", // or github, webhook. A human-readable service name to make things look pretty
    "details": {
        // ... connection specific details, can be configured.
    }
}
```

## PUT /v1/{roomId}/connections/{type}

Create a new connection of a given type. The type refers to the `IConnection.CanonicalEventType`. The `{roomId}` parameter is the target Matrix room.

The body of the request is the configuration for the connection, which will be the "ConnectionState" interface for each connection.

### Request body
```json5
{
    // ... connection specific details, can be configured.
}
```
### Response

```json5
{
    "type": "uk.half-shot.matrix-hookshot.jira.project", // Corresponds to the state type in the connection
    "id": "opaque-unique-id", // An opaque ID used to refer to this connection. Should **NOT** be assumed to be stable.
    "service": "jira", // or github, webhook. A human-readable service name to make things look pretty
    "details": {
        // ... connection specific details, can be configured.
    }
}
```

## PATCH /v1/{roomId}/connections/{id}

Update a connection's configuration. The `id` refers to the `id` returned in the GET response.

The body of the request is the configuration for the connection, which will be the "ConnectionState" interface for each connection.

### Request body
```json5
{
    // ... connection specific details, can be configured.
}
```
### Response

```json5
{
    "type": "uk.half-shot.matrix-hookshot.jira.project", // Corresponds to the state type in the connection
    "id": "opaque-unique-id", // An opaque ID used to refer to this connection. Should **NOT** be assumed to be stable.
    "service": "jira", // or github, webhook. A human-readable service name to make things look pretty
    "details": {
        // ... connection specific details, can be configured.
    }
}
```

## DELETE /v1/{roomId}/connections/{id}

Delete a connection. The `id` refers to the `id` returned in the GET response.
### Response

```json5
{
    "ok": true
}
```

# Service specific APIs

Some services have specific APIs for additional functionality, like OAuth.

## GitHub


### GET /github/v1/oauth?userId={userId}


Request an OAuth url for the given user. Once the user has completed the steps in the OAuth process,
the bridge will be granted access.

### Response

```json5
[{
    "url": "https://github.com/login/oauth/authorize?..."
}]
```

## JIRA


### GET /jira/v1/oauth?userId={userId}


Request an OAuth url for the given user. Once the user has completed the steps in the OAuth process,
the bridge will be granted access.

### Response

```json5
[{
    "url": "https://auth.atlassian.com/authorize?..."
}]
```