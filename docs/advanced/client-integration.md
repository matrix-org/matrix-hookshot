# Client integration

Client integration lets Matrix clients interact directly with Hookshot service bot integrations. It is disabled by default. To enable it, add the following to the Hookshot configuration:

```yaml
messaging:
  allowClientIntegration: true
```

The current implementation uses Matrix to-device messages for e.g. capability probes. It provides a transport-level response; without an integration handler, the response reports `unavailable`. Additional client integration flows may be introduced in the future.

The homeserver and appservice registration must support to-device transactions and device masquerading. See the [encryption guide](./encryption.md#running-with-synapse) for the Synapse settings and check the to-device entries in `registration.sample.yml`. These transport prerequisites apply even when Hookshot encryption is disabled.
