# hookshot

![Version: 0.1.13](https://img.shields.io/badge/Version-0.1.13-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: 3.2.0](https://img.shields.io/badge/AppVersion-3.2.0-informational?style=flat-square)
Deploy a Matrix Hookshot instance to Kubernetes

Status: Beta

## About

This chart creates a basic Hookshot deployment inside Kubernetes.

# Installation

You'll need to have the Helm repository added to your local environment:

``` bash
helm repo add hookshot https://matrix-org.github.io/matrix-hookshot
helm repo update
```

Which should allow you to see the Hookshot chart in the repo:

``` bash
helm search repo hookshot

NAME                            CHART VERSION   APP VERSION     DESCRIPTION               
matrix-org/hookshot             0.1.13          1.16.0          A Helm chart for Kubernetes
```

Before you can install, however, you'll need to make sure to configure Hookshot properly.

# Configuration

You'll need to create a `values.yaml` for your deployment of this chart. You can use the [included defaults](./values.yaml) as a starting point.

## Helm Values

To configure Hookshot-specific parameters, the value `.Values.hookshot.config` accepts an arbitrary YAML map as configuration. This gets templated into the container by [templates/configmap.yaml](./templates/configmap.yaml) - thus anything you can set in the [Example Configuration](https://matrix-org.github.io/matrix-hookshot/latest/setup/sample-configuration.html) can be set here.

## Existing configuration

If you have an existing configuration file for Hookshot, you can create a configmap like so:

``` bash
kubectl create --namespace "your hookshot namespace" configmap hookshot-custom-config --from-file=config.yml --from-file=registration.yml --from-file=passkey.pem
```

Note that the filenames must remain as listed based on the templating done in [templates/configmap.yaml](./templates/configmap.yaml)

Once created, you can set `.Values.hookshot.existingConfigMap` to `custom-hookshot-config` (or whichever name you chose for your secret) and set `.Values.hookshot.config` to `{}` or null to prevent confusion with the default parameters.

# Installation

Once you have your `values.yaml` file ready you can install the chart like this:

``` bash
helm install hookshot --create-namespace --namespace hookshot matrix-org/hookshot -f values.yaml
```

And upgrades can be done via:

``` bash
helm upgrade hookshot --namespace hookshot matrix-org/hookshot -f values.yaml
```

# External access

You'll need to configure your Ingress connectivity according to your environment. This chart should be compatible with most Ingress controllers and has been tested successfully with [ingress-nginx](https://github.com/kubernetes/ingress-nginx) and EKS ALB. You should also ensure that you have a way to provision certificates i.e. [cert-manager](https://cert-manager.io/) as HTTPS is required for appservice traffic.

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| affinity | object | `{}` | Affinity settings for deployment |
| autoscaling.enabled | bool | `false` |  |
| fullnameOverride | string | `""` | Full name override for helm chart |
| hookshot.config | object | `{"bridge":{"bindAddress":"0.0.0.0","domain":"example.com","port":9002,"url":"https://example.com"},"generic":{"allowJsTransformationFunctions":true,"enableHttpGet":false,"enabled":true,"urlPrefix":"https://example.com/","userIdPrefix":"_webhooks_","waitForComplete":false},"listeners":[{"bindAddress":"0.0.0.0","port":9000,"resources":["webhooks","widgets"]},{"bindAddress":"0.0.0.0","port":9001,"resources":["metrics"]}],"logging":{"colorize":false,"json":false,"level":"info","timestampFormat":"HH:mm:ss:SSS"},"metrics":{"enabled":true},"passFile":"/data/passkey.pem","widgets":{"addToAdminRooms":false,"branding":{"widgetTitle":"Hookshot Configuration"},"publicUrl":"https://webhook-hookshot.example.com/widgetapi/v1/static","roomSetupWidget":{"addOnInvite":false},"setRoomName":false}}` | Raw Hookshot configuration. Gets templated into a YAML file and then loaded unless an existingConfigMap is specified. |
| hookshot.existingConfigMap | string | `nil` | Name of existing ConfigMap with valid Hookshot configuration |
| hookshot.passkey | string | `""` |  |
| hookshot.registration.as_token | string | `""` |  |
| hookshot.registration.hs_token | string | `""` |  |
| hookshot.registration.id | string | `"matrix-hookshot"` |  |
| hookshot.registration.namespaces.rooms | list | `[]` |  |
| hookshot.registration.namespaces.users | list | `[]` |  |
| hookshot.registration.rate_limited | bool | `false` |  |
| hookshot.registration.sender_localpart | string | `"hookshot"` |  |
| hookshot.registration.url | string | `"http://example.com"` |  |
| image.pullPolicy | string | `"IfNotPresent"` | Pull policy for Hookshot image |
| image.repository | string | `"halfshot/matrix-hookshot"` | Repository to pull hookshot image from |
| image.tag | string | `nil` | Image tag to pull. Defaults to chart's appVersion value as set in Chart.yaml |
| imagePullSecrets | list | `[]` | List of names of k8s secrets to be used as ImagePullSecrets for the pod |
| ingress.appservice.annotations | object | `{}` | Annotations for appservice ingress |
| ingress.appservice.className | string | `""` | Ingress class name for appservice ingress |
| ingress.appservice.enabled | bool | `false` | Enable ingress for appservice |
| ingress.appservice.hosts | list | `[]` | Host configuration for appservice ingress |
| ingress.appservice.tls | list | `[]` | TLS configuration for appservice ingress |
| ingress.webhook.annotations | object | `{}` | Annotations for webhook ingress |
| ingress.webhook.className | string | `""` | Ingress class name for webhook ingress |
| ingress.webhook.enabled | bool | `false` | Enable ingress for webhook |
| ingress.webhook.hosts | list | `[]` | Host configuration for webhook ingress |
| ingress.webhook.tls | list | `[]` | TLS configuration for webhook ingress |
| nameOverride | string | `""` | Name override for helm chart |
| nodeSelector | object | `{}` | Node selector parameters |
| podAnnotations | object | `{}` | Extra annotations for Hookshot pod |
| podSecurityContext | object | `{}` | Pod security context settings |
| replicaCount | int | `1` | Number of replicas to deploy. Consequences of using multiple Hookshot replicas currently unknown. |
| resources | object | `{}` | Pod resource requests / limits |
| securityContext | object | `{}` | Security context settings |
| service.annotations | object | `{}` | Extra annotations for service |
| service.appservice.port | int | `9002` | Appservice port as configured in container |
| service.labels | object | `{}` | Extra labels for service |
| service.metrics.port | int | `9001` | Metrics port as configured in container |
| service.port | int | `80` | Port for Hookshot service |
| service.type | string | `"ClusterIP"` | Service type for Hookshot service |
| service.webhook.port | int | `9000` | Webhook port as configured in container |
| serviceAccount.annotations | object | `{}` | Annotations to add to the service account |
| serviceAccount.create | bool | `true` | Specifies whether a service account should be created |
| serviceAccount.name | string | `""` | The name of the service account to use. If not set and create is true, a name is generated using the fullname template |
| tolerations | list | `[]` | Tolerations for deployment |

----------------------------------------------
Autogenerated from chart metadata using [helm-docs v1.11.0](https://github.com/norwoodj/helm-docs/releases/v1.11.0)