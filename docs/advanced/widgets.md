Widgets
=======

<section class="warning">
Widgets themselves are still not part of the stable Matrix spec (currently it's defined as a proposal in <a rel="noopener" href="https://github.com/matrix-org/matrix-spec/issues/285" target="_blank">matrix-spec/285</a>, and
so there can be no guarantees about client support or stability of the feature).
</section>

Hookshot supports using widgets to configure connections in rooms. Widgets allow users to view and configure rooms without the need to type commands. The widget feature is designed to complement
the existing command system, rather than replace it.

<img alt="Example of a configuration widget" src="./widgets.png" style="display: block; margin-left: auto; width: 500px; margin-right: auto;"></img>


### Configuration

```yaml
widgets:
  addToAdminRooms: false
  roomSetupWidget:
    addOnInvite: false
# disallowedIpRanges:
#     - 127.0.0.0/8
#     - 10.0.0.0/8
#     - 172.16.0.0/12
#     - 192.168.0.0/16
#     - 100.64.0.0/10
#     - 192.0.0.0/24
#     - 169.254.0.0/16
#     - 192.88.99.0/24
#     - 198.18.0.0/15
#     - 192.0.2.0/24
#     - 198.51.100.0/24
#     - 203.0.113.0/24
#     - 224.0.0.0/4
#     - ::1/128
#     - fe80::/10
#     - fc00::/7
#     - 2001:db8::/32
#     - ff00::/8
#     - fec0::/10
  publicUrl: https://example.com/widgetapi/v1/static
  branding:
    widgetTitle: Hookshot Configuration
  openIdOverrides:
    my-local-server: "http://localhost"
```

The admin room feature is still very barebones so while it's included here for completeness, most instances
should leave `addToAdminRooms` off (as it is by default). This flag will add an "admin room" widget to user admin rooms.

The room setup feature is more complete, supporting generic webhook configuration (with more options coming soon).
This can be enabled by setting `roomSetupWidget` to an object. You can add the widget by saying `!hookshot setup-widget` in any room.
When `addOnInvite` is true, the bridge will add a widget to rooms when the bot is invited, and the room has **no existing connections**.

`disallowedIpRanges` describes which IP ranges should be disallowed when resolving homeserver IP addresses (for security reasons).
Unless you know what you are doing, it is recommended to not include this key. The default blocked IPs are listed above for your convenience.

`publicUrl` should be set to the publicly reachable address for the widget `public` content. By default, Hookshot hosts this content on the
`widgets` listener under `/widgetapi/v1/static`.

`branding` allows you to change the strings used for various bits of widget UI. At the moment you can:
 - Set `widgetTitle` to change the title of the widget that is created.

`openIdOverrides` allows you to configure the correct federation endpoints for a given set of Matrix server names. This is useful if you are
testing/developing Hookshot in a local dev environment. Production environments should not use this configuration (as their Matrix server name
should be resolvable). The config takes a mapping of Matrix server name => base path for federation.
E.g. if your server name was `my-local-server` and your federation was readable via http://localhost/_matrix/federation,
you would put configure `my-local-server: "http://localhost"`.

In addition to setting up the widgets config, you must bind a listener for the widgets resource in your `listeners` config.

```yaml
listeners:
  - port: 5069
    bindAddress: 0.0.0.0
    resources:
      - widgets
```

See the [setup page](../setup#listeners-configuration) for more information on listeners.

### API

The API for widgets is currently in flux due to being fairly new, and it's not recommended
to develop against it at this time. At a future date this API will be merged with the existing
provisioning API and the details will be published.

