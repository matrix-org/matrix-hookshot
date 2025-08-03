# Webhooks

Matrix Hookshot supports two types of webhooks: **Inbound** (previously known as Generic Webhooks) and **Outbound**.

## Configuration

To enable webhooks in Hookshot, update the configuration file as follows:

```yaml
generic:
  enabled: true
  outbound: true  # Enable outbound webhook support
  urlPrefix: https://example.com/mywebhookspath/
  allowJsTransformationFunctions: false
  waitForComplete: false
  enableHttpGet: false
  # maxExpiryTime: 30d
  # sendExpiryNotice: false
  # userIdPrefix: webhook_
```

## Inbound Webhooks

Inbound webhooks allow external services to send messages to Matrix rooms without understanding the Matrix protocol. Services send HTTP requests to a unique webhook URL, and Hookshot transforms the payload into a Matrix message.

> **Note:** Older versions of the bridge listened on `/` instead of `/webhook`. While `/` still works, administrators should update configurations to use `/webhook`.

### Webhook Listener Configuration

- The bridge listens for incoming webhook requests on the host and port specified in the [`listeners` configuration](../setup.md#listeners-configuration).
- `urlPrefix` specifies the externally accessible URL of your webhook handler. For example, if your load balancer forwards webhook requests from `https://example.com/mywebhookspath` to the bridge (`/webhook`), an example webhook URL would be:
  
  ```
  https://example.com/mywebhookspath/abcdef
  ```

- `waitForComplete` determines when Hookshot responds to webhook requests:
  - `false` (default): Responds immediately with `200 OK` after receiving the request.
  - `true`: Waits until the Matrix message is sent before responding.
  
- `enableHttpGet` allows webhooks to be triggered using `GET` requests. This was previously enabled by default but is now disabled due to security concerns.
- `maxExpiryTime` (default: unlimited) sets how long a webhook remains valid before expiration (e.g., `30d` for 30 days).
  - `sendExpiryNotice`: Sends a warning message before expiry.
  - `requireExpiryTime`: Prevents webhooks from being created without an expiry time.

#### Webhook Authentication and User Configuration

You can assign a unique user ID prefix for webhook connections in Matrix rooms using `userIdPrefix`. For example, if `webhook_` is the prefix and the connection name is `example`, the generated user ID would be `@webhook_example:example.com`.

To register these users, update `registration.yaml`:

```yaml
# registration.yaml
namespaces:
  users:
    - regex: "@webhook_.+:example.com"
      exclusive: true
```

### Adding a Webhook to a Room

1. Invite the bot user to the Matrix room.
2. Ensure the bot has permission to send state events (usually requires Moderator access).
3. Send the following command in the room:
   
   ```
   !hookshot webhook example
   ```
   
   Replace `example` with a meaningful name for your webhook.
4. The bot will generate a webhook URL to use with external services.

### Webhook Payload Handling

Hookshot supports `POST`, `PUT`, and optionally `GET` (if enabled) for incoming webhooks. The body of the request must be in one of the following formats:

| Content-Type | Format |
|-------------|--------|
| `application/json` | JSON |
| `application/x-www-form-urlencoded` | Web form data |
| `text/*` | Plain text |
| `/xml` or `+xml` | XML |

If a request contains:

- A `text` key: This becomes the message body in Matrix.
- A `html` key: This becomes the formatted message body in Matrix.
- A `username` key: The message is prefixed with the username.
- No `text` field: The entire payload is sent to the room.

For more advanced processing, you can use JavaScript transformation functions.

### JavaScript Transformations

> **Warning:** Even though scripts run in a sandboxed environment, avoid running untrusted code.

Transformation scripts allow you to modify webhook payloads before they are sent to a Matrix room. To enable this feature, set:

```yaml
allowJsTransformationFunctions: true
```

#### Example Script (V2 API)

If `data` is:

```json
{"counter": 5, "maxValue": 4}
```

Then, the script:

```js
if (data.counter > data.maxValue) {
    result = {plain: `**Alert!** Counter exceeded by ${data.counter - data.maxValue}`, version: "v2"};
} else {
    result = {plain: `Counter is within safe limits.`, version: "v2"};
}
```

### Webhook Testing Tools

To test your webhooks, consider using:

- **[Beeceptor](https://beeceptor.com/)** – Set up a mock endpoint for capturing webhook requests.
- **[PostBin](https://www.postb.in/)** – Inspect and debug webhook requests.

## Outbound Webhooks

Hookshot can also send outbound webhooks when messages appear in Matrix rooms. Enable this with:

```yaml
generic:
  outbound: true
```

### Request Format

Hookshot sends `PUT` requests to an external service. The request contains:

| Header | Description |
|--------|-------------|
| `X-Matrix-Hookshot-EventId` | The Matrix event ID. |
| `X-Matrix-Hookshot-RoomId` | The room where the message was sent. |
| `X-Matrix-Hookshot-Token` | Authentication token for verification. |

The payload uses `multipart/form-data` and includes:

- `event`: The raw Matrix event data (decrypted if the message was encrypted).
- `media`: If the event contains media, this file holds the referenced media.

> **Note:** Ensure your external service can handle and filter events based on the `type` field in the event JSON.
