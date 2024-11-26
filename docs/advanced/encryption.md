Encryption
==========

<section class="notice">
Support for encryption is considered stable, but the underlying specification changes are not yet.

Hookshot supports end-to-bridge encryption via [MSC3202](https://github.com/matrix-org/matrix-spec-proposals/pull/3202), and [MSC4203](https://github.com/matrix-org/matrix-spec-proposals/pull/4203). Hookshot needs to be configured against a a homeserver that supports these features, such as [Synapse](#running-with-synapse).

Please check with your homeserver implementation before reporting bugs against matrix-hookshot.
</section>



## Enabling encryption in Hookshot

In order for Hookshot to use encryption, it must be configured as follows:
- The `encryption.storagePath` setting must point to a directory that Hookshot has permissions to write files into. If running with Docker, this path should be within a volume (for persistency). Hookshot uses this directory for its crypto store (i.e. long-lived state relating to its encryption keys).
    - Once a crypto store has been initialized, its files must not be modified, and Hookshot cannot be configured to use another crypto store of the same type as one it has used before. If a crypto store's files get lost or corrupted, Hookshot may fail to start up, or may be unable to decrypt command messages. To fix such issues, stop Hookshot, then reset its crypto store by running `yarn start:resetcrypto`.
- [Redis](./workers.md) must be enabled. Note that worker mode is not yet supported with encryption, so `queue` MUST **NOT be configured**.

If you ever reset your homeserver's state, ensure you also reset Hookshot's encryption state. This includes clearing the `storagePath` directory and all worker state stored in your redis instance. Otherwise, Hookshot may fail on start up with registration errors.

Also ensure that Hookshot's appservice registration file contains every line from `registration.sample.yml` that appears after the `If enabling encryption` comment. Note that changing the registration file may require restarting the homeserver that Hookshot is connected to.

## Running with Synapse

[Synapse](https://github.com/matrix-org/synapse/) has functional support for MSC3202 and MSC4203 as of [v1.63.0](https://github.com/matrix-org/synapse/releases/tag/v1.63.0). To enable it, add the following section to Synapse's configuration file (typically named `homeserver.yaml`):

You may notice that MSC2409 is not listed above. Due to the changes being split out from MSC2409, `msc2409_to_device_messages_enabled` refers to MSC4203.

```yaml
experimental_features:
  msc3202_device_masquerading: true
  msc3202_transaction_extensions: true
  msc2409_to_device_messages_enabled: true
```

