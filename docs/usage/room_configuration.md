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

The availablilty of connection types depends on the configuration provided to hookshot.


### The `!hookshot` command

Rooms can be bridged by inviting the hookshot bot into a room, and then running the 
`!hookshot` command. Running `!hookshot help` will give you some details, but you should
see the documentation provided for information on each connection type.
