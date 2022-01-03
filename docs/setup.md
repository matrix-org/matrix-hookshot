Getting setup
=============

This page explains how to set up Hookshot for use with a Matrix homeserver.

## Requirements

Hookshot is fairly light on resources, and can run in as low as 100MB or so of memory. Hookshot memory requirements
may increase depending on the traffic and the number of rooms bridged.


## Local installation 

This bridge requires at least Node 12 (though 16 is preferred), and Rust installed.

To install Node.JS, [nvm](https://github.com/nvm-sh/nvm) is a good option.

To install Rust, [rustup](https://rustup.rs/) is the preferred solution to stay up to date.

To clone and install, run:

```bash
git clone git@github.com:Half-Shot/matrix-hookshot.git
cd matrix-hookshot
yarn # or npm i
```

Starting the bridge (after configuring it), is a matter of running `yarn start`.

## Installation via Docker

To get started quickly, you can use the Docker image [`halfshot/matrix-hookshot`](https://hub.docker.com/r/halfshot/matrix-hookshot)

```bash
docker run \
    --name matrix-hookshot \
    -d \
    -p 9993:9993 \ # Homeserver port
    -p 9000:9000 \ # Webhook port
    -p 9002:9002 \ # Metrics port
    -v /etc/matrix-hookshot:/data \
    halfshot/matrix-hookshot:latest
```

Where `/etc/matrix-hookshot` would contain the configuration files `config.yml` and `registration.yml`, along with any other files needed.


## Configuration

Copy the `config.sample.yml` to a new file `config.yml`. The sample config is also hosted
[here](./setup/sample-configuration.md) for your convienence.

You should read and fill this in as the bridge will not start without a complete config.

Copy `registration.sample.yml` into `registration.yml` and fill in:
- At a minimum, you will need to replace the `as_token` and `hs_token` and change the domain part of the namespaces.

You will need to link the registration file to the homeserver. Consult your homeserver documentation
on how to add appservices. [Synapse documents the process here](https://matrix-org.github.io/synapse/latest/application_services.html).

### Listeners configuration

You will need to configure some listeners to make the bridge functional.

```yaml
  # (Optional) HTTP Listener configuration.
  # Bind resource endpoints to ports and addresses.
  # 'resources' may be any of webhooks, widgets, metrics, provisioning, appservice
  #
  - port: 9000
    bindAddress: 0.0.0.0
    resources:
      - webhooks
      - widgets
  - port: 9001
    bindAddress: 127.0.0.1
    resources:
      - metrics
      - provisioning
```

At a minimum, you should bind the `webhooks` resource to a port and address. You can have multiple resources on the same
port, or one on each.

You will also need to make this port accessible to the internet so services like GitHub can reach the bridge. It
is recommended to factor hookshot into your load balancer configuration, but currrently this process is left as an
excercise to the user.

### Services configuration

You will need to configure some services. Each service has it's own documentation file inside the the setup subdirectory.

- [GitHub](./setup/github.md)
- [GitLab](./setup/gitlab.md)
- [Jira](./setup/jira.md)
- [Webhooks](./setup/webhooks.md)
