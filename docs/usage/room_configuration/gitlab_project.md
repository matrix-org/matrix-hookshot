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
  6. If you have configured the bridge with a `publicUrl` inside `gitlab.webhook`, it will automatically provision the webhook for you.
  7. Otherwise, you'll need to manually configure the webhook to point to your public address for the webhooks listener.

## Configuration

This connection supports a few options which can be defined in the room state:

| Option | Description | Allowed values | Default |
|--------|-------------|----------------|---------| 
|ignoreHooks|Choose to exclude notifications for some event types|Array of: [Supported event types](#supported-event-types) |*empty*|
|commandPrefix|Choose the prefix to use when sending commands to the bot|A string, ideally starts with "!"|`!gh`|
|pushTagsRegex|Only mention pushed tags which match this regex|Regex string|*empty*|
|prDiff|Show a diff in the room when a PR is created, subject to limits|`{enabled: boolean, maxLines: number}`|`{enabled: false}`|
|includingLabels|Only notify on issues matching these label names|Array of: String matching a label name|*empty*|
|excludingLabels|Never notify on issues matching these label names|Array of: String matching a label name|*empty*|


### Supported event types

This connection supports sending messages when the following actions happen on the repository.

- merge_request
  - merge_request.close
  - merge_request.merge
  - merge_request.open
  - merge_request.review.comments
  - merge_request.review
- push
- release
  - release.created
- tag_push
- wiki
