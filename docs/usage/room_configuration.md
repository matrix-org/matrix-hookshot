Room Configuration
==================

Hookshot works off the principle of **Connections**.


A room can have many connections to different services. The connections are defined
in the room state of a room. A connection defines the service it connects to, the
type of integration (e.g. GitHub repo, Jira Project) and any additional configuration.

<figure>
{{#include ./room_configuration/connections1.svg}}
<figcaption>Figure 1. An example of a room connected to GitHub and JIRA</figcaption>
</figure>

Hookshot supports several connection types, which are defined under the Room Configuration
heading.

The availability of connection types depends on the configuration provided to hookshot.


### The `!hookshot` command

Rooms can be bridged by inviting the hookshot bot into a room, and then running the
`!hookshot` command. Running `!hookshot help` will give you some details, but you should
see the documentation provided for information on each connection type.

### Room Upgrade Handling

When a room version is upgraded, Hookshot will automatically copy over the necessary state, including all 'hookshot.*' events, to the new room. This ensures that the configuration is preserved during the upgrade process.

### Manual State Copy Command

In addition to automatic handling of room upgrades, Hookshot also provides a manual command to copy state from another room. This can be useful in scenarios where a user performs a manual room upgrade and Hookshot does not have the necessary permissions to copy the state immediately.

To manually copy state from another room, use the following command:

```
!hookshot copy_state <sourceRoomId>
```

Replace `<sourceRoomId>` with the ID of the room from which you want to copy the state. This command will copy all 'hookshot.*' events from the specified source room to the current room.
