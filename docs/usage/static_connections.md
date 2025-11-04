# Static Connections

Hookshot can also now be configured with "static connections". These allow system administrators to
configure Hookshot with pre-specified set of connections which cannot be altered at runtime, but will
have predictable configuration without any interactions with Matrix.

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

See [the webhook documentation](../setup/webhooks) for more help on
configuring hooks.
