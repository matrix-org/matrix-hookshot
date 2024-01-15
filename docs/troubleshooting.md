Troubleshooting
===============

If you are having difficulties getting set up with hookshot, the advice below might be able to resolve common issues.

If none of these help, please come chat to us in ([#hookshot:half-shot.uk](https://matrix.to/#/#hookshot:half-shot.uk)). Please
try to follow these steps first, as live support is best effort.

## 1. The hookshot bot doesn't acknowledge an invite.

In 99% of cases, this is because the homeserver cannot reach the appservice. Synapse for example will log an error like:

```log
synapse.http.client - 422 - INFO - as-recoverer-339 - Error sending request to  PUT http://yourhookshoturl/_matrix/app/v1/transactions/123: ConnectionRefusedError Connection refused
synapse.appservice.api - 405 - WARNING - as-recoverer-339 - push_bulk to http://yourhookshoturl threw exception(ConnectionRefusedError) Connection was refused by other side: 111: Connection refused. args=('Connection refused',)
synapse.appservice.scheduler - 480 - INFO - as-recoverer-339 - Scheduling retries on hookshot in Ns
```

It's hard to offer targeted advice on resolving networking issues, but a good thing to try is to check whether
you can reach hookshot at all from the homeservers environment. For instance:

```sh
$ curl http://yourhookshoturl/_matrix/app/
```

should give you a response (even if it's an error).

### Docker

It is also worth noting that if you are in a docker environment, the `url` in your registration YAML file **must** match the
path Synapse expects to reach the service on. So if your container is called `hookshot` and it's configured to listen
on port `9993`, then you should configure the `url` to be `http://hookshot:9993`.

## 2. The bot joins, but doesn't respond to my messages.

Check that you are sending the right format message. `!hookshot help` should always work.
Otherwise, check whether the room is encrypted and you haven't [enabled encryption](./advanced/encryption.html) for the bot.
The bot will ignore any messages in encrypted rooms.

You'll need to either create the room as unencrypted or enable encryption for the bot.

If this doesn't resolve your issue, check [Problem #1](#1-the-hookshot-bot-doesnt-acknowledge-an-invite) to make
sure it's not a networking issue.

## 3. The bot works, but is offline in my client.

This is expected. Hookshot doesn't support "presence" which is how Matrix determines online/offline status.
