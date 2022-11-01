Setting up GitHub
======
## GitHub App

This bridge requires a [GitHub App](https://github.com/settings/apps/new). You will need to create one.

### Webhook

The **Webhook URL** should point to the public address of your hookshot instance, at the `/` path.
You **MUST** also provide a secret, which should match the `github.webhook.secret` value in your config.

### Permissions

You will need to enable the following permissions:

  - Repository
    - Actions (`read`)
    - Contents (`read`)
    - Discussions (`read & write`)
    - Issues (`read & write`)
    - Metadata
    - Projects (`read & write`)
    - Pull requests (`read & write`)
 - Organisation
    - Team Discussions (`read & write`)

Hookshot handles the following webhook event types:

- Commit comment
- Create
- Delete
- Discussion
- Discussion comment
- Issue comment
- Issues
- Project
- Project card
- Project column
- Pull request
- Pull request review
- Pull request review comment
- Push
- Release
- Repository
- Workflow run

You can disable any of these to disable the events being handled in Hookshot.

Once you have setup your app, you can move onto configuring the bridge:

## Bridge Configuration

The GitHub service requires a few connection options.

```yaml
github:
  enterpriseUrl: "https://your-enterprise-address.com"
  auth:
    id: 123
    privateKeyFile: github-key.pem
  webhook:
    secret: secrettoken
  oauth:
    client_id: foo
    client_secret: bar
    redirect_uri: https://example.com/bridge_oauth/
  defaultOptions:
    showIssueRoomLink: false
```

If you are using an on-premise / enterprise edition of GitHub, you need provide the base URL in `enterpriseUrl`.
You do not need to specify the `/api/...` path in the URL.

In the `auth` section, you will need to supply the **App ID** given in your GitHub App page.
The `privateKeyFile` can be generated by clicking "Generate a private key" under the **Private keys** section on the GitHub app page.
Docker users should store this file alongside `config.yml` and provide the path `/data/github-key.pem`.

The `webhook` section takes a secret, which is **Webhook secret** on the GitHub App page.

The `oauth` section should include both the **Client ID** and **Client Secret** on the GitHub App page.
The `redirect_uri` value must be the **public** path to `/oauth` on the webhooks path. E.g. if your load balancer
points `https://example.com/hookshot` to the bridge `webhooks` listener, you should use the path `https://example.com/hookshot/oauth`.
This value MUST exactly match the **Callback URL** on the GitHub App page.

`defaultOptions` allows you to set some defaults for room connections. Options listed on [this page](../usage/room_configuration/github_repo.md#configuration)
are supported.

## Next steps

If you have followed these steps correctly, GitHub should now be configured with hookshot 🥳.

You can now follow the guide on [authenticating with GitHub](../usage/auth.md), and then [bridging a room](../usage/room_configuration/github_repo.md#setting-up)