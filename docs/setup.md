Getting setup
=============

This bridge requires at least Node 12, and Rust installed. If you do not have rust, https://rustup.rs/ is the quickest way to get it.

Start by cloning the repository.

` git clone git@github.com:Half-Shot/matrix-hookshot.git`

Install the dependencies

```sh
cd matrix-hookshot
yarn
```

## Configuration

Copy the `config.sample.yml` to a new file called `config.yml`.

You should read and fill this in as the bridge will not start without a complete config.

Copy `registration.sample.yml` into `registration.yml` and fill in. 

You will need to link the registration file to the homeserver. Consult your homeserver documentation on how to add appservices. [Synapse documents the process here](https://matrix-org.github.io/synapse/latest/application_services.html)

### Services configuration

You will need to configure some services. Each service has it's own documentation file inside the the setup subdirectory.