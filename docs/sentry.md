Sentry
======

Hookshot supports [Sentry](https://sentry.io/welcome/) error reporting.

You can configure Sentry by adding the following to your config:

```yaml
sentry:
  dsn: https://examplePublicKey@o0.ingest.sentry.io/0 # The DSN for your Sentry project.
  environment: production # The environment sentry is being used in. Can be omitted.
```

Sentry will automatically include the name of your homeserver as the `serverName` reported.
