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
|enableHooks [^1]|Enable notifications for some event types|Array of: [Supported event types](#supported-event-types) |If not defined, defaults are mentioned below|
|ignoreHooks [^1]|**deprecated** Choose to exclude notifications for some event types|Array of: [Supported event types](#supported-event-types) |*empty*|
|commandPrefix|Choose the prefix to use when sending commands to the bot|A string, ideally starts with "!"|`!gh`|
|showIssueRoomLink|When new issues are created, provide a Matrix alias link to the issue room|`true/false`|`false`|
|prDiff|Show a diff in the room when a PR is created, subject to limits|`{enabled: boolean, maxLines: number}`|`{enabled: false}`|
|includingLabels|Only notify on issues matching these label names|Array of: String matching a label name|*empty*|
|excludingLabels|Never notify on issues matching these label names|Array of: String matching a label name|*empty*|
|hotlinkIssues|Send a link to an issue/PR in the room when a user mentions a prefix followed by a number|` { prefix: string }`|`{prefix: "#"}`|
|newIssue|Configuration options for new issues|`{ labels: string[] }`|*empty*|
|newIssue.labels|Automatically set these labels on issues created via commands|Array of: String matching a label name|*empty*|
|workflowRun|Configuration options for workflow run results|`{ matchingBranch: string }`|*empty*|
|workflowRun.matchingBranch|Only report workflow runs if it matches this regex.|Regex string|*empty*|
|workflowRun.includingWorkflows|Only report workflow runs with a matching workflow name.|Array of: String matching a workflow name|*empty*|
|workflowRun.excludingWorkflows|Never report workflow runs with a matching workflow name.|Array of: String matching a workflow name|*empty*|


[^1]: `ignoreHooks` is no longer accepted for new state events. Use `enableHooks` to explicitly state all events you want to see.



### Supported event types

This connection supports sending messages when the following actions happen on the repository.

Note: Some of these event types are enabled by default (marked with a `*`). When `ignoreHooks` *is* defined,
the events marked as default below will be enabled. Otherwise, this is ignored.

- issue *
  - issue.created *
  - issue.changed *
  - issue.edited *
  - issue.labeled *
- pull_request *
  - pull_request.closed *
  - pull_request.merged *
  - pull_request.opened *
  - pull_request.ready_for_review *
  - pull_request.reviewed *
- push
- release *
  - release.created *
  - release.drafted
- workflow.run
  - workflow.run.success
  - workflow.run.failure
  - workflow.run.neutral
  - workflow.run.cancelled
  - workflow.run.timed_out
  - workflow.run.stale
  - workflow.run.action_required
