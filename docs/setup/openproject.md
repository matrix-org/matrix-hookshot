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

## Next steps

If you have followed these steps correctly, OpenProject should now be configured 🥳.

You can now follow the guide on [authenticating with OpenProject](../usage/auth.md#openproject).
