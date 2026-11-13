# Static Connections

Hookshot can also now be configured with "static connections". These allow system administrators to
configure Hookshot with pre-specified set of connections which cannot be altered at runtime, and which
do not need to be set up with commands or the widget.

A static connection only becomes active once the bot has joined the room. Invite the bot (for example
`@hookshot:example.org`, or the service bot for that connection type) to the room: the connection
activates as soon as the bot joins, without restarting Hookshot. The user who invites the bot needs
[permission](../setup.md#permissions) to use Hookshot, otherwise the bot rejects the invite. Until the
bot has joined, Hookshot logs a warning on startup and does not handle the connection.

Changes to static connections in the config file take effect after Hookshot is restarted.

Not all connection types are currently suitable for static configuration, the supported types are listed below.

### Generic Hook `uk.half-shot.matrix-hookshot.generic.hook`

Generic (inbound) webhooks can be configured, an example configuration is below:

```yaml
connections:
 - connectionType: uk.half-shot.matrix-hookshot.generic.hook
   stateKey: id-used-by-webhook
   roomId: "!any-room-id:example.org"
   state:
     name: My static hook
     # All below are optional
     waitForComplete: true
     includeHookBody: true
     expirationDate: 2025-11-03T16:44:59.533Z
     transformationFunction: |
        result = {
            plain: "*Everything is fine*",
            version: "v2",
        };
}
```

You may then send requests to `http(s)://example.org/webhooks/id-used-by-webhook` to activate the webhook.
Until the bot has joined the room, these requests return `404`. With the default power levels, the bot
does not need to be a moderator.

See [the webhook documentation](../setup/webhooks) for more help on
configuring hooks.
