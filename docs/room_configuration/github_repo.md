GitHub Repository
=================

## Setting up

To set up a connection to a GitHub Repository in a new room:

(N.B you must have permission to bridge GitHub repositories before you can use this command, see [auth](../auth.html#github))

1. Invite the bridge bot (e..g `@hookshot:example.com`)
2. Give the bridge bot moderator permissions or higher (power level 50).
3. Send the command `!hookshot github repo https://github.com/my/project`
4. If you have permission to bridge this repo, the bridge will respond with a confirmation message.
5. Note: The bridge will need to either:
    - Have a GitHub installation registered with the organisation
    - The requesting user must be authenticated with the bridge via OAuth and the repository must be part of their GitHub account.

## Configuration

This connection supports a few options which can be defined in the room state:

| Option | Description | Allowed values | Default |
|--------|-------------|----------------|---------| 
|ignoreHooks|Choose to exclude notifications for some event types|Array of: [Supported event types](#supported-event-types) |*empty*|
|commandPrefix|Choose the prefix to use when sending commands to the bot|A string, ideally starts with "!"|`!gh`|
|showIssueRoomLink|When new issues are created, provide a Matrix alias link to the issue room|`true/false`|`false`|
|prDiff|Show a diff in the room when a PR is created, subject to limits|`{enabled: boolean, maxLines: number}`|`{enabled: false}`|
|includingLabels|Only notify on issues matching these label names|Any string matching a label name|*empty*|
|excludingLabels|Never notify on issues matching these label names|Any string matching a label name|*empty*|


### Supported event types

This connection supports sending messages when the following actions happen on the repository.

- issue
  - issue.created
  - issue.changed
  - issue.edited
- pull_request
  - pull_request.closed
  - pull_request.merged
  - pull_request.opened
  - pull_request.ready_for_review
  - pull_request.reviewed
- release
  - release.created
