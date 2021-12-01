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

## GET /v1/connectiontypes

Request the connection types enabled for this bridge.

### Response

```json5
{
    "JiraProject": {
        "type": "JiraProject", // The name of the connection
        "eventType": "uk.half-shot.matrix-hookshot.jira.project", // Corresponds to the state type for the connection
        "service": "jira", // or github, webhook. A human-readable service name to make things look pretty
        "botUserId": "@hookshot:yourdomain.com", // The bot mxid for the service. Currently this is the sender_localpart, but may change in the future.
    }
}
```

## GET /v1/{roomId}/connections

Request the connections for a given room. The `{roomId}` parameter is the target Matrix room.

### Response

```json5
[{
    "type": "JiraProject", // The name of the connection
    "eventType": "uk.half-shot.matrix-hookshot.jira.project", // Corresponds to the state type in the connection
    "id": "opaque-unique-id", // An opaque ID used to refer to this connection. Should **NOT** be assumed to be stable.
    "service": "jira", // or github, webhook. A human-readable service name to make things look pretty
    "botUserId": "@hookshot:yourdomain.com", // The bot mxid for the service. Currently this is the sender_localpart, but may change in the future.
    "config": {
        // ... connection specific details, can be configured.
    }
}]
```


## GET /v1/{roomId}/connections/{id}

Request details of a single connection. The `{roomId}` parameter is the target Matrix room.

### Response

```json5
{

    "type": "JiraProject", // The name of the connection
    "eventType": "uk.half-shot.matrix-hookshot.jira.project", // Corresponds to the state type in the connection
    "id": "opaque-unique-id", // An opaque ID used to refer to this connection. Should **NOT** be assumed to be stable.
    "service": "jira", // or github, webhook. A human-readable service name to make things look pretty
    "botUserId": "@hookshot:yourdomain.com", // The bot mxid for the service. Currently this is the sender_localpart, but may change in the future.
    "config": {
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

    "type": "JiraProject", // The name of the connection
    "eventType": "uk.half-shot.matrix-hookshot.jira.project", // Corresponds to the state type in the connection
    "id": "opaque-unique-id", // An opaque ID used to refer to this connection. Should **NOT** be assumed to be stable.
    "service": "jira", // or github, webhook. A human-readable service name to make things look pretty
    "botUserId": "@hookshot:yourdomain.com", // The bot mxid for the service. Currently this is the sender_localpart, but may change in the future.
    "config": {
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

    "type": "JiraProject", // The name of the connection
    "eventType": "uk.half-shot.matrix-hookshot.jira.project", // Corresponds to the state type in the connection
    "id": "opaque-unique-id", // An opaque ID used to refer to this connection. Should **NOT** be assumed to be stable.
    "service": "jira", // or github, webhook. A human-readable service name to make things look pretty
    "botUserId": "@hookshot:yourdomain.com", // The bot mxid for the service. Currently this is the sender_localpart, but may change in the future.
    "config": {
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
{
    "url": "https://auth.atlassian.com/authorize?..."
}
```

### GET /jira/v1/account?userId={userId}


Request the status of the users account. This will return a `loggedIn` value to determine if the
bridge has a JIRA identity stored for the user, and any instances they have access to. Note that if a 
user does not have access to an instance, they can authenticate again to gain access to it (if they are able
to consent).
### Response

```json5
{
    "loggedIn": true,
    "instances": {
        "name": "acme",
        "url": "https://acme.atlassian.net"
    }
}
```

### GET /jira/v1/instances/{instanceName}/projects?userId={userId}

Request a list of all projects a user can see in a given instance. The `url` value of a project can be given to create
a new JIRA connection.
### Response

```json5
{
    "loggedIn": true,
    "instances": {
        "name": "acme",
        "url": "https://acme.atlassian.net"
    }
}