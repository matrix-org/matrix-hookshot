# Service Bots

Hookshot supports additional bot users called "service bots" which handle a particular connection type
(in addition to the default bot user which can handle any connection type).
These bots can coexist in a room, each handling a different service.

## Configuration

Service bots can be given a different localpart, display name, avatar, and command prefix.  
They will only handle connections for the specified service, which can be one of:
* `feeds` - [Feeds](../setup/feeds.md)
* `figma` - [Figma](../setup/figma.md)
* `generic` - [Webhooks](../setup/webhooks.md)
* `github` - [GitHub](../setup/github.md)
* `gitlab` - [GitLab](../setup/gitlab.md)
* `jira` - [Jira](../setup/jira.md)

For example with this configuration:
```yaml
serviceBots:
  - localpart: feeds
    displayname: Feeds
    avatar: "./assets/feeds_avatar.png"
    prefix: "!feeds"
    service: feeds
```

There will be a bot user `@feeds:example.com` which responds to commands prefixed with `!feeds`, and only handles feeds connections.

For the homeserver to allow hookshot control over users, they need to be added to the list of user namespaces in the `registration.yml` file provided to the homeserver.

In the example above, you would need to add these lines:
```yaml
    - regex: "@feeds:example.com" # Where example.com is your homeserver's domain
      exclusive: true
```
