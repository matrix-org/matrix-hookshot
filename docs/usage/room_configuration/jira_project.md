# JIRA Project

This connection type connects a JIRA project to a room.

You can run commands to create and assign issues, and receive notifications when issues are created.

## Setting up

To set up a connection to a JIRA project in a new room:

(NB you must have permission to bridge JIRA projects before you can use this command, see [auth](../auth.html#jira).)

1. Create a new, unencrypted room. It can be public or private.
1. Invite the bridge bot (e.g. `@hookshot:example.com`).
1. Give the bridge bot moderator permissions or higher (power level 50) (or otherwise configure the room so the bot can edit room state).
1. Send the command `!hookshot jira project https://jira-instance/.../projects/PROJECTKEY/...`.
1. If you have permission to bridge this repo, the bridge will respond with a confirmation message.

## Managing connections

Send the command `!hookshot jira list project` to list all of a room's connections to JIRA projects.

Send the command `!hookshot jira remove project <url>` to remove a room's connection to a JIRA project at a given URL.

## Configuration

This connection supports a few options which can be defined in the room state:

| Option        | Description                                               | Allowed values                                            | Default         |
| ------------- | --------------------------------------------------------- | --------------------------------------------------------- | --------------- |
| events        | Choose to include notifications for some event types      | Array of: [Supported event types](#supported-event-types) | `issue_created` |
| commandPrefix | Choose the prefix to use when sending commands to the bot | A string, ideally starts with "!"                         | `!jira`         |

### Supported event types

This connection supports sending messages when the following actions happen on the project.

- issue
  - issue_created
  - issue_updated
- version
  - version_created
  - version_updated
  - version_released
