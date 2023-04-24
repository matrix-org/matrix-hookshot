Encryption
==========

<section class="warning">
Encryption support is <strong>HIGHLY EXPERIMENTAL AND SUBJECT TO CHANGE</strong>. It should not be enabled for production workloads.
For more details, see <a href="https://github.com/matrix-org/matrix-hookshot/issues/594">issue 594</a>.
</section>

Hookshot supports end-to-bridge encryption via [MSC3202](https://github.com/matrix-org/matrix-spec-proposals/pull/3202). As such, encryption requires hookshot to be connected to a homeserver that supports that MSC, such as [Synapse](#running-with-synapse).

## Enabling encryption in Hookshot

In order for hookshot to use encryption, it must be configured as follows:
- The `experimentalEncryption.storagePath` setting must point to a directory that hookshot has permissions to write files into. If running with Docker, this path should be within a volume (for persistency). Hookshot uses this directory for its crypto store (i.e. long-lived state relating to its encryption keys).
    - By default, the crypto store uses an SQLite-based format. To use the legacy Sled-based format, set `experimentalEncryption.useLegacySledStore` to `true`, though this is not expected to be necessary and will be removed in a future release.
    - Once a crypto store of a particular type (SQLite or Sled) has been initialized, its files must not be modified, and hookshot cannot be configured to use another crypto store of the same type as one it has used before. If a crypto store's files get lost or corrupted, hookshot may fail to start up, or may be unable to decrypt command messages. To fix such issues, stop hookshot, then reset its crypto store by running `yarn start:resetcrypto`.
- [Redis](./workers.md) must be enabled. Note that worker mode is not yet supported with encryption, so `queue.monolithic` must be set to `true`.

If you ever reset your homeserver's state, ensure you also reset hookshot's encryption state. This includes clearing the `experimentalEncryption.storagePath` directory and all worker state stored in your redis instance. Otherwise, hookshot may fail on start up with registration errors.

Also ensure that hookshot's appservice registration file contains every line from `registration.sample.yml` that appears after the `If enabling encryption` comment. Note that changing the registration file may require restarting the homeserver that hookshot is connected to.

## Running with Synapse

[Synapse](https://github.com/matrix-org/synapse/) has functional support for MSC3202 as of [v1.63.0](https://github.com/matrix-org/synapse/releases/tag/v1.63.0). To enable it, add the following section to Synapse's configuration file (typically named `homeserver.yaml`):

```yaml
experimental_features:
  msc3202_device_masquerading: true
  msc3202_transaction_extensions: true
  msc2409_to_device_messages_enabled: true
```
