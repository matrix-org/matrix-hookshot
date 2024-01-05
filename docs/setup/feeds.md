# Feeds

You can configure hookshot to bridge RSS/Atom feeds into Matrix.

## Configuration

```yaml
feeds:
  # (Optional) Configure this to enable RSS/Atom feed support
  #
  enabled: true
  pollIntervalSeconds: 600
```

`pollIntervalSeconds` specifies how often each feed will be checked for updates.
It may be checked less often if under exceptional load, but it will never be checked more often than every `pollIntervalSeconds`.

Each feed will only be checked once, regardless of the number of rooms to which it's bridged.

No entries will be bridged upon the “initial sync” -- all entries that exist at the moment of setup will be considered to be already seen.

Please note that Hookshot **must** be configured with Redis to retain seen entries between restarts. By default, Hookshot will
run an "initial sync" on each startup and will not process any entries from feeds from before the first sync.

## Usage

### Adding new feeds

To add a feed to your room:

- Invite the bot user to the room.
- Make sure the bot able to send state events (usually the Moderator power level in clients)
- Say `!hookshot feed <URL>` where `<URL>` links to an RSS/Atom feed you want to subscribe to.

### Listing feeds

You can list all feeds that a room you're in is currently subscribed to with `!hookshot feed list`.
It requires no special permissions from the user issuing the command. Optionally you can format the list as `json` or
`yaml` with `!hookshot feed list <format>`.

### Removing feeds

To remove a feed from a room, say `!hookshot feed remove <URL>`, with the URL specifying which feed you want to unsubscribe from.

### Feed templates

You can optionally give a feed a specific template to use when sending a message into a room. A template
may include any of the following tokens:

| Token      | Description                                                |
| ---------- | ---------------------------------------------------------- |
| $FEEDNAME  | Either the label, title or url of the feed.                |
| $FEEDURL   | The URL of the feed.                                       |
| $FEEDTITLE | The title of the feed.                                     |
| $TITLE     | The title of the feed entry.                               |
| $URL       | The URL of the feed entry.                                 |
| $LINK      | The link of the feed entry. Formatted as `[$TITLE]($URL)`. |
| $AUTHOR    | The author of the feed entry.                              |
| $DATE      | The publish date (`pubDate`) of the entry.                 |
| $SUMMARY   | The summary of the entry.                                  |

If not specified, the default template is `New post in $FEEDNAME: $LINK`.
