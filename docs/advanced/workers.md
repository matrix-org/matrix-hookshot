Workers
=======

Hookshot supports running in a worker configuration, using Redis as the middleman process to handle traffic between processes.

<section class="warning">
This feature is <b>experimental</b> and should only be used when you are reaching natural limits in the monolith process.
</section>

## Running in multi-process mode

You must first have a working Redis instance somewhere which can talk between processes. For example, in Docker you can run:

`docker run --name redis-host -p 6379:6379 -d redis`.

The processes should all share the same config, which should contain the correct config to enable Redis:

```yaml
queue:
  redisUri: "redis://redis-host:6379"
cache:
  redisUri: "redis://redis-host:6379"
```

Note that if [encryption](./encryption.md) is enabled, you MUST enable the `cache` config but NOT the `queue` config. Workers require persistent
storage in Redis, but cannot make use of worker-mode queues.

Once that is done, you can simply start the processes by name using yarn:
```
yarn start:webhooks
yarn start:matrixsender
yarn start:app
```

Be aware that you will need to start all worker types when running in worker mode, as the service does not allow a hybrid worker approach.
