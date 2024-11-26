GitLab Project
=================

This connection type connects a GitLab project (e.g. https://gitlab.matrix.org/matrix-org/olm) to a room.

## Setting up

To set up a connection to a GitLab project in a new room:

(NB you must have permission to bridge GitLab repositories before you can use this command, see [auth](../auth.html#gitlab).)

1. Create a new, unencrypted room. It can be public or private.
2. Invite the bridge bot (e.g. `@hookshot:example.com`).
3. Give the bridge bot moderator permissions or higher (power level 50) (or otherwise configure the room so the bot can edit room state).
4. Send the command `!hookshot gitlab project https://mydomain/my/project`.
5. If you have permission to bridge this repo, the bridge will respond with a confirmation message. (Users with `Developer` permissions or greater can bridge projects.)
6. If you have configured the bridge with a `publicUrl` inside `gitlab.webhook` in your [config](../../setup/gitlab.md), you authenticated with Hookshot on that instance in your admin room, and you have `Maintainer` permissions or greater on the project, the bot will automatically provision the webhook for you.
7. Otherwise, you'll need to manually configure the project with a webhook that points to your public address for the webhooks listener, sets the "Secret token" to the one you put in your Hookshot configuration (`gitlab.webhook.secret`), and enables all Triggers that need to be bridged (as Hookshot can only bridge events for enabled Triggers). This can be configured on the GitLab webpage for the project under Settings > Webhook Settings. If you do not have access to this page, you must ask someone who does (i.e. someone with at least `Maintainer` permissions on the project) to add the webhook for you.

## Configuration

This connection supports a few options which can be defined in the room state:

| Option | Description | Allowed values | Default |
|--------|-------------|----------------|---------|
|commandPrefix|Choose the prefix to use when sending commands to the bot|A string, ideally starts with "!"|`!gl`|
|enableHooks [^1]|Enable notifications for some event types|Array of: [Supported event types](#supported-event-types) |If not defined, defaults are mentioned below|
|excludingLabels|Never notify on issues matching these label names|Array of: String matching a label name|*empty*|
|ignoreHooks [^1]|**deprecated** Choose to exclude notifications for some event types|Array of: [Supported event types](#supported-event-types) |*empty*|
|includeCommentBody|Include the body of a comment when notifying on merge requests|Boolean|false|
|includingLabels|Only notify on issues matching these label names|Array of: String matching a label name|*empty*|
|pushTagsRegex|Only mention pushed tags which match this regex|Regex string|*empty*|


[^1]: `ignoreHooks` is no longer accepted for new state events. Use `enableHooks` to explicitly state all events you want to see.


### Supported event types

This connection supports sending messages when the following actions happen on the repository.

Note: Some of these event types are enabled by default (marked with a `*`). When `ignoreHooks` *is* defined,
the events marked as default below will be enabled. Otherwise, this is ignored.

- merge_request *
  - merge_request.close *
  - merge_request.merge *
  - merge_request.open *
  - merge_request.reopen *
  - merge_request.review.comments *
  - merge_request.review *
  - merge_request.review.individual
- push *
- release *
  - release.created *
- tag_push *
- wiki *
