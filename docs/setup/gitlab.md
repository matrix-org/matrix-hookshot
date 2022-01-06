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
```

You neeed to list all the instances you plan to connect to in the `config.yml`. This is
used so that users can give a short name like `gitlab` or `matrix.org` when they want
to specify an instance.

The webhooks secret should be generated, for use in your repositories.

## Adding a repository

Adding a repository is a case of navigating to the settings page, and then adding a new webhook.
You will want to give the URL of the public address for the hookshot webhooks port on the `/` path.

You should add the events you wish to trigger on. Hookshot currently supports:

- Push events
- Tag events
- Issues events
- Merge request events
- Releases events

You will need to do this each time you want to a repository to hookshot. 

To then bridge a room to GitLab, you will need to add a `uk.half-shot.matrix-hookshot.gitlab.repository`
 *state event* to a room containing a content of:

```json5
{
    "instance": "gitlab", // your instance name
    "path": "yourusername/repo" // the full path to the repo
}
```

Once this is done, you are bridged 🥳.
