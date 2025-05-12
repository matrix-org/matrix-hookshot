# Webhooks

Hookshot supports two types of webhooks: inbound (previously known as Generic Webhooks) and outbound. This guide will help you configure, use, and test webhooks effectively.

---

## Configuration

To enable webhooks, you need to update the configuration file. Below is an example configuration:

```yaml
generic:
  enabled: true
  outbound: true # Enables outbound webhook support
  urlPrefix: https://example.com/mywebhookspath/
  allowJsTransformationFunctions: false
  waitForComplete: false
  enableHttpGet: false
  # maxExpiryTime: 30d
  # sendExpiryNotice: false
  # userIdPrefix: webhook_
```

### Key Configuration Options

| Option                          | Description                                                                                     | Default Value |
|---------------------------------|-------------------------------------------------------------------------------------------------|---------------|
| `enabled`                       | Enables or disables webhooks.                                                                  | `false`       |
| `outbound`                      | Enables outbound webhook support.                                                              | `false`       |
| `urlPrefix`                     | The public-facing URL prefix for your webhook handler.                                         | N/A           |
| `allowJsTransformationFunctions`| Allows JavaScript transformation functions for payloads.                                       | `false`       |
| `waitForComplete`               | Waits for webhook processing to complete before sending a response.                            | `false`       |
| `enableHttpGet`                 | Enables triggering webhooks via `GET` requests.                                                | `false`       |
| `maxExpiryTime`                 | Sets the maximum duration a webhook can remain valid.                                          | Unlimited     |
| `sendExpiryNotice`              | Sends a notice when a webhook is close to expiring.                                            | `false`       |
| `userIdPrefix`                  | Prefix for creating specific users for webhook connections.                                    | N/A           |

---

## Inbound Webhooks

Inbound webhooks allow external services to send messages into Matrix rooms without needing to understand the Matrix protocol. This is achieved by sending HTTP payloads to a unique URL, which the bridge transforms into Matrix messages.

### Listener Path

The webhook listener listens on the `/webhook` path. For example, if your `urlPrefix` is `https://example.com/mywebhookspath/`, an example webhook URL would look like:

```
https://example.com/mywebhookspath/abcdef
```

### Configuration Details

- **`waitForComplete`**: If set to `true`, the bridge waits until the webhook is processed before responding. Use this if the service sending the webhook requires confirmation of message delivery.
- **`enableHttpGet`**: Allows triggering webhooks via `GET` requests. This is disabled by default due to security concerns.

---

## Adding a Webhook

To add a webhook to your room:

1. Invite the bot user to the room.
2. Ensure the bot has permission to send state events (usually the Moderator power level).
3. Use the command `!hookshot webhook example`, where `example` is the name of your webhook.
4. The bot will respond with a unique webhook URL. Use this URL in the external service to send events.

---

## Webhook Handling

Hookshot supports `POST`, `PUT`, and optionally `GET` HTTP methods for webhooks. Here’s how the payload is processed:

1. **`text` Key**: If the payload contains a `text` key, it is used as the message body in Matrix. The text is automatically converted from Markdown to HTML unless an `html` key is provided.
2. **`html` Key**: If the payload contains an `html` key, it is used as the formatted message body in Matrix. A fallback `text` key is still required.
3. **`username` Key**: If the payload contains a `username` key, the username is prepended to both the `text` and `html` message bodies.
4. **No `text` Key**: If the payload does not contain a `text` key, the entire payload is sent to the room. You can adapt this using a JavaScript transformation function.

---

## Testing Webhooks

Testing your webhook setup is crucial to ensure it works as expected. Here are some tools you can use:

- **[Beeceptor](https://beeceptor.com/)**: Create a mock endpoint to inspect incoming webhook requests.
- **[Pipedream](https://pipedream.com/requestbin)**: Set up a request bin to capture and debug webhook payloads.


## Payload formats

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
  "mentions": { // Explicitly mention these users, see https://spec.matrix.org/latest/client-server-api/#user-and-room-mentions 
    "room": true,
    "user_ids": ["@foo:bar"]
  },
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

## Request format

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
