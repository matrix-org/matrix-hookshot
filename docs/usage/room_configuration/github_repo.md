GitHub Repository
=================

This connection type connects a GitHub repository (e.g. https://github.com/matrix-org/matrix-hookshot) to a room.

You can run commands to create and manipulate issues, and receive notifications when something changes such as
a new release.

## Setting up

To set up a connection to a GitHub Repository in a new room:

(NB you must have permission to bridge GitHub repositories before you can use this command, see [auth](../auth.html#github).)

1. The bridge will need to either:
    - Have a GitHub installation registered with the organisation (or GitHub user account)
    - The requesting user must be authenticated with the bridge via OAuth and the repository must be part of their GitHub account.
2. Create a new, unencrypted room. It can be public or private.
3. Invite the bridge bot (e.g. `@hookshot:example.com`).
4. Give the bridge bot moderator permissions or higher (power level 50) (or otherwise configure the room so the bot can edit room state).
5. Send the command `!hookshot github repo https://github.com/my/project`.
6. If you have permission to bridge this repo, the bridge will respond with a confirmation message.

## Configuration

This connection supports a few options which can be defined in the room state:

| Option | Description | Allowed values | Default |
|--------|-------------|----------------|---------| 
|ignoreHooks|Choose to exclude notifications for some event types|Array of: [Supported event types](#supported-event-types) |*empty*|
|commandPrefix|Choose the prefix to use when sending commands to the bot|A string, ideally starts with "!"|`!gh`|
|showIssueRoomLink|When new issues are created, provide a Matrix alias link to the issue room|`true/false`|`false`|
|prDiff|Show a diff in the room when a PR is created, subject to limits|`{enabled: boolean, maxLines: number}`|`{enabled: false}`|
|includingLabels|Only notify on issues matching these label names|Array of: String matching a label name|*empty*|
|excludingLabels|Never notify on issues matching these label names|Array of: String matching a label name|*empty*|
|hotlinkIssues|Send a link to an issue/PR in the room when a user mentions a prefix followed by a number|` { prefix: string }`|`{prefix: "#"}`|
|newIssue|Configuration options for new issues|`{ labels: string[] }`|*empty*|
|newIssue.labels|Automatically set these labels on issues created via commands|Array of: String matching a label name|*empty*|


### Supported event types

This connection supports sending messages when the following actions happen on the repository.

- issue
  - issue.created
  - issue.changed
  - issue.edited
  - issue.labeled
- pull_request
  - pull_request.closed
  - pull_request.merged
  - pull_request.opened
  - pull_request.ready_for_review
  - pull_request.reviewed
- release
  - release.created
