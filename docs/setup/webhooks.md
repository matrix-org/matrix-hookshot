# Webhooks

Hookshot supports generic webhook support so that services can send messages into Matrix rooms without being aware of the Matrix protocol.

## Configuration

You will need to add the following configuration to the config file.

```yaml
generic:
  enabled: true
  urlPrefix: https://example.com/mywebhookspath/
  allowJsTransformationFunctions: false
```

The bridge listens for incoming webhooks on the host and port provided in the `webhook` configuration section. For example,
a internal hook URL (using the default port) would look like `http://0.0.0.0:9000/abcdef`.

`urlPrefix` describes the public facing URL of your webhook handler. For instance, if your load balancer redirected
webhook requests from `https://example.com/mywebhookspath` to the bridge, an example webhook URL would look like:
`https://example.com/mywebhookspath/abcdef`.

## Adding a webhook

To add a webhook to your room:
  - Invite the bot user to the room.
  - Make sure the bot able to send state events (usually the Moderator power level in clients)
  - Say `!setup webhook`
  - The bot will respond with the webhook URL to be sent to services.

## JS Transformations

This bridge support creating small JS snippets to translate an incoming webhook payload into a message for the room, giving
you a very powerful ability to generate messages based on whatever input is coming in.

The input is parsed and exectuted within a seperate JS Virtual Machine context, and is limited to an execution time of 2 seconds.
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

### Example script

Where `data` = `{"counter": 5, "maxValue": 4}`

```js
if (data.counter > data.maxValue) {
    result = `**Oh no!** The counter has gone over by ${data.counter - data.maxValue}`
} else {
    result = `*Everything is fine*, the counter is under by ${data.maxValue - data.counter}`
}
```