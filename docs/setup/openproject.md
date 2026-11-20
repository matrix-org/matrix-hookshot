# OpenProject

Setting up Hookshot for OpenProject requires setting up webhooks, and configuring
an OAuth2 application so that users may login.

### OpenProject

Set up OpenProject to send Webhook requests to hookshot, following [the documentation](https://www.openproject.org/docs/system-admin-guide/api-and-webhooks/#webhooks). Please note the following:

1. The payload URL will be the address of your [`webhooks` listener](https://matrix-org.github.io/matrix-hookshot/latest/setup.html#listeners-configuration), with the path of `/openproject/webhook`.
2. The secret **must** be set, and must match the value of `webhook.secret` below.
3. Hookshot currently uses the "Work packages" events, although more will follow in the future.
4. You may enable as many projects as you like, but Hookshot must be configured to route the projects via
   it's connections principle.

You must also setup an OAuth application, following [the documentation](https://www.openproject.org/docs/system-admin-guide/authentication/oauth-applications/). Please note the following:

1. The Redirect URL will be the address of your [`webhooks` listener](https://matrix-org.github.io/matrix-hookshot/latest/setup.html#listeners-configuration), with the path of `/openproject/oauth`.
2. Only the scope `api_v3` is used.
3. Confidential access should be enabled.
4. Do not set a Client Credentials User ID.

Please keep a record of the Client ID and Client Secret to be used in the next step.

### Hookshot

You can now set some configuration in the bridge `config.yml`:

```yaml
openProject:
  baseUrl: https://your-open-project.com
  webhook:
    secret: secrettoken
  oauth:
    clientId: foo
    clientSecret: bar
    redirectUri: https://example.com/oauth/
```

### Timeline commands

Use the connection's configured command prefix for timeline commands. The
project picker sets it to `!openproject <project-identifier>` by default, so a
connection for `demo-project` uses `!openproject demo-project timeline add <id>`
and `!openproject demo-project timeline remove <id>`. If the connection prefix
is configured as `!openproject`, omit the project identifier.

Adding requires the sender to be logged in to OpenProject and the work package
to belong to the connected project. Removing marks an existing timeline anchor
inactive, does not change the work package in OpenProject, and does not require
an OpenProject login. Removing an ID with no active anchor is an idempotent
no-op. Both commands require the sender to have Hookshot command permission for
OpenProject.

The room configuration's event choices control which OpenProject changes send
activity messages to the room. These are display-only `m.notice` messages; the
separate automatic-anchor choice controls whether a work package gets a
replaceable timeline card. Activity messages continue when automatic anchors
are disabled or a card has been removed. When a card is active, an activity
message links back to its original timeline event.

Active timeline anchors are stored by Hookshot. Without a `cache` configuration,
Hookshot uses in-memory storage and loses active anchor records when it restarts.
Configure Redis to preserve anchors across restarts, for example:

```yaml
cache:
  redisUri: redis://localhost:6379
```

## Next steps

If you have followed these steps correctly, OpenProject should now be configured 🥳.

You can now follow the guide on [authenticating with OpenProject](../usage/auth.md#openproject).
