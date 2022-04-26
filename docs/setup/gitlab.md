# GitLab

## Configuration

GitLab configuration is fairly straight-forward:

```yaml
  # (Optional) Configure this to enable GitLab support
  #
  instances:
    gitlab:
      url: https://gitlab.com
  webhook:
    secret: secrettoken
    publicUrl: https://example.com/webhooks/
```

You need to list all the instances you plan to connect to in the `config.yml`. This is
used so that users can give a short name like `gitlab` or `matrix.org` when they want
to specify an instance.

You should generate a webhook `secret` (e.g. `pwgen -n 64 -s 1`) and then use this as your
"Secret token" when adding webhooks.

The `publicUrl` must be the URL where GitLab webhook events are received (i.e. the path to `/`
for your `webhooks` listener).

## Adding a repository

You can now follow the guide on [authenticating with GitLab](../usage/auth.md), and then [bridging a room](../usage/room_configuration/gitlab_project.md#setting-up)

