# Helm Deployment

<section class="notice">
    The Hookshot Helm chart previously published at <a rel="noreferrer" target="_blank" href="https://matrix-org.github.io/matrix-hookshot">https://matrix-org.github.io/matrix-hookshot</a>
    is <strong>deprecated</strong>. Hookshot is now available as a component of the
    <a rel="noreferrer" target="_blank" href="https://github.com/element-hq/ess-helm">ess-helm `matrix-stack` chart</a>, which is actively
    maintained and supports standalone deployment (no other ESS components required).
</section>

## Installing with ess-helm

Hookshot is provided via [ess-helm](https://github.com/element-hq/ess-helm), a project managed by Element. While
ESS is primarily intended for setting up a complete Matrix stack, it can also be used to install individual components.

This documentation assumes you are planning to install standalone. If this is not the case then
please read the [documentation for ESS](https://docs.element.io/latest/element-server-suite-pro/configuring-components/configuring-hookshot).

Please read the [Prerequisites of ess-helm](https://github.com/element-hq/ess-helm#resource-requirements).

### Minimum values.yaml for standalone Hookshot

```yaml
# Your Matrix server domain — used to scope user/room IDs and permissions.
# This is the domain part of Matrix IDs (e.g. example.com from @user:example.com),
# NOT the hostname of the Hookshot service itself.
serverName: example.com

hookshot:
  enabled: true
  ingress:
    host: hookshot.example.com   # hostname where webhooks will be recieved/widgets are viewed.

# Disable all other ESS components
synapse:
  enabled: false
elementWeb:
  enabled: false
elementAdmin:
  enabled: false
matrixAuthenticationService:
  enabled: false
matrixRTC:
  enabled: false
wellKnownDelegation:
  enabled: false
deploymentMarkers:
  enabled: false

# redis and initSecrets are enabled by default and are required — do not disable them
# unless you are providing an external Redis and managing secrets manually.
```

### Installation

```sh
helm upgrade --install --namespace ess --create-namespace ess oci://ghcr.io/element-hq/ess-helm/matrix-stack -f values.yaml --wait
```

By default, `initSecrets` will auto-generate the appservice registration file and passkey on
first install. See [Secret management](#secret-management) below if you need to provide these
yourself (e.g. when migrating an existing deployment).

## Configuring Hookshot

The new chart auto-generates the core Hookshot configuration. You do **not** need to specify
these.

Service-specific configuration (GitHub, Jira, generic webhooks, etc.) is added via
`hookshot.additional`, which merges fragments into the generated config:

```yaml
hookshot:
  additional:
    user-config.yaml:
      config: |
        generic:
          enabled: true
          allowJsTransformationFunctions: false
          waitForComplete: true
          enableHttpGet: false
```

Configuration can also be loaded from a Kubernetes Secret:

```yaml
hookshot:
  additional:
    another-config-file.yaml:
      configSecret: my-hookshot-secret
      configSecretKey: key-within-secret.yaml
```

See the [Hookshot configuration reference](https://matrix-org.github.io/matrix-hookshot/latest/setup/sample-configuration.html)
and the [ess-helm advanced configuration guide](https://github.com/element-hq/ess-helm/blob/main/docs/advanced.md#configuring-hookshot)
for full details.

## Secret management

### Auto-generated secrets (default)

By default, `initSecrets` generates the appservice registration file and RSA passkey on first
install. This is the simplest path for new deployments.

### Providing secrets inline

If you are migrating an existing deployment, you **must** provide your existing registration
tokens — generating new ones requires re-registering the appservice with your homeserver and
will break the existing bridge.

```yaml
hookshot:
  passkey:
    value: |
      -----BEGIN PRIVATE KEY-----
      <your existing RSA private key>
      -----END PRIVATE KEY-----

  appserviceRegistration:
    value: |
      id: hookshot
      hs_token: "your-existing-hs-token"
      as_token: "your-existing-as-token"
      url: "http://hookshot:9993"
      sender_localpart: hookshot
      rate_limited: false
      namespaces:
        users:
          - regex: "@_hookshot_.*:example.com"
            exclusive: true

initSecrets:
  enabled: false
```

### Providing secrets from existing Kubernetes Secrets

```yaml
hookshot:
  passkey:
    secret: my-hookshot-secrets
    secretKey: passkey.pem

  appserviceRegistration:
    secret: my-hookshot-secrets
    secretKey: registration.yaml

initSecrets:
  enabled: false
```

## Migrating from the old chart

### Key differences

|                           | Old chart (`matrix-org/hookshot`)                  | New chart (`ess-helm/matrix-stack`)                       |
|---------------------------|----------------------|-----------------------------------------------------------------------------------------|
| **Workload type**         | `Deployment`                                       | `StatefulSet`                                             |
| **Ports**                 | 9000 (webhooks), 9001 (metrics), 9002 (appservice) | 7775 (webhooks), 7777 (metrics), 9993 (appservice)        |
| **Ingress**               | Two separate ingresses (webhook + appservice)      | Single `hookshot.ingress.host`                            |
| **Config**                | Full YAML in `hookshot.config`                     | Core auto-generated; extensions via `hookshot.additional` |
| **Secrets**               | Manual (passkey + registration required)           | Auto-generated by default (`initSecrets`)                 |

### Values mapping

| Old value                       | New value                                               | Notes                          |
|---------------------------------|---------------------------------------------------------|--------------------------------|
| `image.repository`              | `hookshot.image.registry` + `hookshot.image.repository` | Registry split from path       |
| `image.tag`                     | `hookshot.image.tag`                                    | Same semantics                 |
| `hookshot.passkey`              | `hookshot.passkey.value`                                | Or omit to auto-generate       |
| `hookshot.registration`         | `hookshot.appserviceRegistration.value`                 | Or omit to auto-generate       |
| `hookshot.existingConfigMap`    | `hookshot.additional.<key>.configSecret`                | See config section             |
| `hookshot.config.<service>`     | `hookshot.additional.<key>.config`                      | Service config fragments only  |
| `ingress.webhook.hosts[0].host` | `hookshot.ingress.host`                                 | Single host covers all routes  |
| `ingress.appservice.*`          | _(same `hookshot.ingress.host`)_                        | No separate appservice ingress |
| `resources`                     | `hookshot.resources`                                    | Same structure                 |
| `nodeSelector`                  | `hookshot.nodeSelector`                                 | Same                           |
| `tolerations`                   | `hookshot.tolerations`                                  | Same                           |
| `podSecurityContext`            | `hookshot.podSecurityContext`                           | Same                           |
| `replicaCount`                  | _(not supported)_                                       | StatefulSet; single instance   |
| `autoscaling.*`                 | _(not supported)_                                       |                                |

### Config migration

In the old chart, users supplied the entire Hookshot config under `hookshot.config`. In the
new chart, the following sections are **auto-generated** from chart values — do not include
them in `hookshot.additional`:

- `bridge` (domain from `serverName`, port/bind from chart defaults)
- `passFile`
- `listeners`
- `logging.level` (set via `hookshot.logging.level`)
- `metrics`
- `permissions` (default: `manageConnections` for `serverName` domain)
- `cache` / Redis URI

Move only the service-specific sections of your old `hookshot.config` into
`hookshot.additional`. For example, if your old values included:

```yaml
# OLD
hookshot:
  config:
    bridge:
      domain: example.com
      url: https://matrix.example.com
    passFile: /secrets/passkey.pem
    logging:
      level: info
    listeners:
      - port: 9000
        resources: [webhooks]
    generic:
      enabled: true
    github:
      auth:
        id: 123
        privateKeyFile: /path/to/key.pem
```

The new equivalent is:

```yaml
# NEW
serverName: example.com

hookshot:
  enabled: true
  logging:
    level: info
  additional:
    services:
      config: |
        generic:
          enabled: true
        github:
          auth:
            id: 123
            privateKeyFile: /path/to/key.pem
```
