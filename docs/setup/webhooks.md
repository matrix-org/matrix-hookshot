# Webhooks

Hookshot supports two kinds of webhooks, inbound (previously known as Generic Webhooks) and outbound.


## Configuration

You will need to add the following configuration to the config file.

```yaml
generic:
  enabled: true
  outbound: true # For outbound webhook support
  urlPrefix: https://example.com/mywebhookspath/
  allowJsTransformationFunctions: false
  waitForComplete: false
  enableHttpGet: false
  # maxExpiryTime: 30d
  # sendExpiryNotice: false
  # userIdPrefix: webhook_
```

## Inbound Webhooks

Hookshot supports generic webhook support so that services can send messages into Matrix rooms without being aware of the Matrix protocol. This works
by having services hit a unique URL that then transforms a HTTP payload into a Matrix message.

<section class="notice">
Previous versions of the bridge listened for requests on `/` rather than `/webhook`. While this behaviour will continue to work,
administators are advised to use `/webhook`.
</section>

The webhooks listener listens on the path `/webhook`.

The bridge listens for incoming webhooks requests on the host and port provided in the [`listeners` config](../setup.md#listeners-configuration).

`urlPrefix` describes the public facing URL of your webhook handler. For instance, if your load balancer redirected
webhook requests from `https://example.com/mywebhookspath` to the bridge (on `/webhook`), an example webhook URL would look like:
`https://example.com/mywebhookspath/abcdef`.

`waitForComplete` causes the bridge to wait until the webhook is processed before sending a response. Some services prefer you always
respond with a 200 as soon as the webhook has entered processing (`false`) while others prefer to know if the resulting Matrix message
has been sent (`true`). By default this is `false`.

`enableHttpGet` means that webhooks can be triggered by `GET` requests, in addition to `POST` and `PUT`. This was previously on by default,
but is now disabled due to concerns mentioned below.

`maxExpiryTime` sets an upper limit on how long a webhook can be valid for before the bridge expires it. By default this is unlimited. This
takes a duration represented by a string. E.g. "30d" is 30 days. See [this page](https://github.com/jkroso/parse-duration?tab=readme-ov-file#available-unit-types-are)
for available units. Additionally: 

  - `sendExpiryNotice` configures whether a message is sent into a room when the connection is close to expiring.
  - `requireExpiryTime` forbids creating a webhook without a expiry time. This does not apply to existing webhooks.

You may set a `userIdPrefix` to create a specific user for each new webhook connection in a room. For example, a connection with a name
like `example` for a prefix of `webhook_` will create a user called `@webhook_example:example.com`. If you enable this option,
you need to configure the user to be part of your registration file e.g.:

```yaml
# registration.yaml
...
namespaces:
  users:
    - regex: "@webhook_.+:example.com" # Where example.com is your domain name.
      exclusive: true
```

### Adding a webhook

To add a webhook to your room:
  - Invite the bot user to the room.
  - Make sure the bot able to send state events (usually the Moderator power level in clients)
  - Say `!hookshot webhook example` where `example` is a name for your hook.
  - The bot will respond with the webhook URL to be sent to services.

### Webhook Handling

Hookshot handles `POST` and `PUT` HTTP requests by default.

Hookshot handles HTTP requests with a method of `GET`, `POST` or `PUT`.

If the request is a `GET` request, the query parameters are assumed to be the body. Otherwise, the body of the request should be a supported payload.

If the body contains a `text` key, then that key will be used as a message body in Matrix (aka `body`). This text will be automatically converted from Markdown to HTML (unless
a `html` key is provided.).

If the body contains a `html` key, then that key will be used as the HTML message body in Matrix (aka `formatted_body`). A `text` key fallback MUST still be provided.

If the body *also* contains a `username` key, then the message will be prepended by the given username. This will be prepended to both `text` and `html`.

If the body does NOT contain a `text` field, the full payload will be sent to the room. This can be adapted into a message by creating a **JavaScript transformation function**.


#### Payload formats

If the request is a `POST`/`PUT`, the body of the request will be decoded and stored inside the event. Currently, Hookshot supports:

- XML, when the `Content-Type` header ends in `/xml` or `+xml`.
- Web form data, when the `Content-Type` header is `application/x-www-form-urlencoded`.
- JSON, when the `Content-Type` header is `application/json`.
- Text, when the `Content-Type` header begins with `text/`.

Decoding is done in the order given above. E.g. `text/xml` would be parsed as XML. Any formats not described above are not
decoded.

#### GET requests

In previous versions of hookshot, it would also handle the `GET` HTTP method. This was disabled due to concerns that it was too easy for the webhook to be
inadvertently triggered by URL preview features in clients and servers. If you still need this functionality, you can enable it in the config.

Hookshot will insert the full content of the body into a key under the Matrix event called `uk.half-shot.hookshot.webhook_data`, which may be useful if you have
other integrations that would like to make use of the raw request body.

<section class="notice">
Matrix does NOT support floating point values in JSON, so the <code>uk.half-shot.hookshot.webhook_data</code> field will automatically convert any float values
to a string representation of that value. This change is <strong>not applied</strong> to the JavaScript transformation <code>data</code>
variable, so it will contain proper float values.
</section>

#### Wait for complete

It is possible to choose whether a webhook response should be instant, or after hookshot has handled the message. The reason
for this is that some services expect a quick response time (like Slack) whereas others will wait for the request to complete. You
can specify this either globally in your config, or on the widget with `waitForComplete`.

If you make use of the `webhookResponse` feature, you will need to enable `waitForComplete` as otherwise hookshot will
immeditately respond with it's default response values.


#### Expiring webhooks

Webhooks can be configured to expire, such that beyond a certain date they will fail any incoming requests. Currently this expiry time
is mutable, so anybody able to configure connections will be able to change the expiry date. Hookshot will send a notice to the room
at large when the webhook has less than 3 days until it's due to expire (if `sendExpiryNotice` is set).

### JavaScript Transformations

<section class="notice">
Although every effort has been made to securely sandbox scripts, running untrusted code from users is always risky. Ensure safe permissions
in your room to prevent users from tampering with the script.
</section>

This bridge supports creating small JavaScript snippets to translate an incoming webhook payload into a message for the room, giving
you a very powerful ability to generate messages based on whatever input is coming in.

The input is parsed and executed within a separate JavaScript Virtual Machine context, and is limited to an execution time of 2 seconds.
With that said, the feature is disabled by default and `allowJsTransformationFunctions` must be enabled in the config.

The code snippets can be edited by editing the Matrix state event corresponding to this connection (with a state type of `uk.half-shot.matrix-hookshot.generic.hook`).
Because this is a fairly advanced feature, this documentation won't go into how to edit state events from your client.
Please seek out documentation from your client on how to achieve this.

The script string should be set within the state event under the `transformationFunction` key.

#### Script API

Transformation scripts have a versioned API. You can check the version of the API that the hookshot instance supports
at runtime by checking the `HookshotApiVersion` variable. If the variable is undefined, it should be considered `v1`.

The execution environment will contain a `data` variable, which will be the body of the incoming request (see [Payload formats](#payload-formats)).
Scripts are executed synchronously and expect the `result` variable to be set.

If the script contains errors or is otherwise unable to work, the bridge will send an error to the room. You can check the logs of the bridge
for a more precise error.

#### V2 API

The `v2` api expects an object to be returned from the `result` variable.

```json5
{
  "version": "v2" // The version of the schema being returned from the function. This is always "v2".
  "empty": true|false, // Should the webhook be ignored and no output returned. The default is false (plain must be provided).
  "plain": "Some text", // The plaintext value to be used for the Matrix message.
  "html": "<b>Some</b> text", // The HTML value to be used for the Matrix message. If not provided, plain will be interpreted as markdown.
  "msgtype": "some.type", // The message type, such as m.notice or m.text, to be used for the Matrix message. If not provided, m.notice will be used.
  "webhookResponse": { // Optional response to send to the webhook requestor. All fields are optional. Defaults listed.
    "body": "{ \"ok\": true }",
    "contentType": "application/json",
    "statusCode": 200
  }
}
```

#### Example script

Where `data` = `{"counter": 5, "maxValue": 4}`

```js
if (data.counter === undefined) {
  // The API didn't give us a counter, send no message.
  result = {empty: true, version: "v2"};
} else if (data.counter > data.maxValue) {
    result = {plain: `**Oh no!** The counter has gone over by ${data.counter - data.maxValue}`, version: "v2"};
} else {
    result = {plain: `*Everything is fine*, the counter is under by ${data.maxValue - data.counter}`, version: "v2"};
}
```


#### V1 API

The v1 API expects `result` to be a string. The string will be automatically interpreted as Markdown and transformed into HTML. All webhook messages
will be prefixed with `Received webhook:`. If `result` is falsey (undefined, false or null) then the message will be `No content`.

#### Example script

Where `data` = `{"counter": 5, "maxValue": 4}`

```js
if (data.counter > data.maxValue) {
    result = `**Oh no!** The counter has gone over by ${data.counter - data.maxValue}`
} else {
    result = `*Everything is fine*, the counter is under by ${data.maxValue - data.counter}`
}
```

## Outbound webhooks

You can also configure Hookshot to send outgoing requests to other services when a message appears
on Matrix. To do so, you need to configure hookshot to enable outgoing messages with:

```yaml
generic:
  outbound: true
```

### Request format

Requests can be sent to any service that accepts HTTP requests. You may configure Hookshot to either use the HTTP `PUT` (default)
or `POST` methods.

Each request will contain 3 headers which you may use to authenticate and direct traffic:

  - 'X-Matrix-Hookshot-EventId' contains the event's ID.
  - 'X-Matrix-Hookshot-RoomId' contains the room ID where the message was sent.
  - 'X-Matrix-Hookshot-Token' is the unique authentication token provided when you created the webhook. Use this
    to verify that the message came from Hookshot.

The payloads are formatted as `multipart/form-data`.

The first file contains the event JSON data, proviced as the `event` file. This is a raw representation of the Matrix event data. If the
event was encrypted, this will be the **decrypted** body.

If any media is linked to in the event, then a second file will be present named `media` which will contain the media referenced in
the event.

All events that occur in the room will be sent to the outbound URL, so be careful to ensure your remote service can filter the
traffic appropriately (e.g. check the `type` in the event JSON)
