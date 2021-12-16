Workers
=======

Hookshot supports running in a worker configuration, using Redis as the middleman process to handle traffic between processes.

This feature is **experimental** and should only be used when you are reaching natural limits in the monolith process.


## Running in multi-process mode

You must first have a working redis instance somewhere which can talk between processes. For example, in Docker you can run:

`docker run --name github-bridge-redis -p 6379:6379 -d redis`.


The processes should all share the same config, which should contain the correct config enable redis:

```yaml
queue:
  monolithic: true
  port: 6379
  host: github-bridge-redis
```

Once that is done, you can simply start the processes by name using yarn:
```
yarn start:webhooks
yarn start:matrixsender 
yarn start:app
```

Be aware that you will need to start all worker types when running in worker mode, as the service does not allow a hybrid worker approach.
