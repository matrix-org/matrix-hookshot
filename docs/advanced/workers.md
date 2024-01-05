Workers
=======

Hookshot supports running in a worker configuration, using Redis as the middleman process to handle traffic between processes.

<section class="warning">
This feature is <b>experimental</b> and should only be used when you are reaching natural limits in the monolith process.
</section>

## Running in multi-process mode

You must first have a working Redis instance somewhere which can talk between processes. For example, in Docker you can run:

`docker run --name github-bridge-redis -p 6379:6379 -d redis`.

The processes should all share the same config, which should contain the correct config to enable Redis:

```yaml
queue:
  monolithic: false
  port: 6379
  host: github-bridge-redis
```

Note that if [encryption](./encryption.md) is enabled, `queue.monolithic` must be set to `true`, as worker mode is not yet supported with encryption.

Once that is done, you can simply start the processes by name using yarn:
```
yarn start:webhooks
yarn start:matrixsender
yarn start:app
```

Be aware that you will need to start all worker types when running in worker mode, as the service does not allow a hybrid worker approach.
