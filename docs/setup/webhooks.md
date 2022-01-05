# Webhooks

Hookshot supports generic webhook support so that services can send messages into Matrix rooms without being aware of the Matrix protocol. This works
by having services hit a unique URL that then transforms a HTTP payload into a Matrix message.

## Configuration

You will need to add the following configuration to the config file.

```yaml
generic:
  enabled: true
  urlPrefix: https://example.com/mywebhookspath/
  allowJsTransformationFunctions: false
```

The bridge listens for incoming webhooks requests on the host and port provided in the [`listeners` config](../setup.md#listeners-configuration).

`urlPrefix` describes the public facing URL of your webhook handler. For instance, if your load balancer redirected
webhook requests from `https://example.com/mywebhookspath` to the bridge an example webhook URL would look like:
`https://example.com/mywebhookspath/abcdef`.

## Adding a webhook

To add a webhook to your room:
  - Invite the bot user to the room.
  - Make sure the bot able to send state events (usually the Moderator power level in clients)
  - Say `!setup webhook`
  - The bot will respond with the webhook URL to be sent to services.

## Webhook Handling

Hookshot handles HTTP requests with a method of `GET`, `POST` or `PUT`.

If the request is a `GET` request, the query parameters are assumed to be the body. Otherwise, the body of the request should be a JSON payload.

If the body contains a `text` key, then that key will be used as a message body in Matrix (aka `body`). This text will be automatically converted from Markdown to HTML (unless
a `html` key is provided.).

If the body contains a `html` key, then that key will be used as the HTML message body in Matrix (aka `formatted_body`). A `text` key fallback MUST still be provided.

If the body *also* contains a `username` key, then the message will be prepended by the given username. This will be prepended to both `text` and `html`.

If the body does NOT contain a `text` field, the full JSON payload will be sent to the room. This can be adapted into a message by creating a **JavaScript transformation function**.

## JavaScript Transformations

<section class="notice">
Although every effort has been made to securely sandbox scripts, running untrusted code from users is always risky. Ensure safe permissions
in your room to prevent users from tampering with the script.
</section>

This bridge supports creating small JavaScript snippets to translate an incoming webhook payload into a message for the room, giving
you a very powerful ability to generate messages based on whatever input is coming in.

The input is parsed and exectuted within a seperate JavaScript Virtual Machine context, and is limited to an execution time of 2 seconds.
With that said, the feature is disabled by default and `allowJsTransformationFunctions` must be enabled in the config.

The code snippets can be edited by editing the Matrix state event corresponding to this connection (with a state type of `uk.half-shot.matrix-hookshot.generic.hook`).
Because this is a fairly advanced feature, this documentation won't go into how to edit state events from your client.
Please seek out documentation from your client on how to achieve this. 

The script string should be set within the state event under the `transformationFunction` key.

### Script API

The scripts have a very minimal API. The execution environment will contain a `data` field, which will be the body
of the incoming request (JSON will be parsed into an `Object`). Scripts are executed syncronously and a variable `result`
is expected to be set in the execution, which will be used as the text value for the script. `result` will be automatically
transformed by a Markdown parser.

If the script contains errors or is otherwise unable to work, the bridge will send an error to the room.

### Example script

Where `data` = `{"counter": 5, "maxValue": 4}`

```js
if (data.counter > data.maxValue) {
    result = `**Oh no!** The counter has gone over by ${data.counter - data.maxValue}`
} else {
    result = `*Everything is fine*, the counter is under by ${data.maxValue - data.counter}`
}
```
