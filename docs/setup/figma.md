# Figma

## Setting up

To bridge Figma webhooks with Hookshot, you will need:
 - A personal access token with admin access to the team you intend to bridge.
 - A figma account that is on the professional tier, as the free tier does provide webhook access.
 - Your team ID. You can get this by going to the team page on Figma, and looking for the ID in the url (e.g. 12345 in `https://www.figma.com/files/team/12345/...`)

## Configuration

You can now set some configuration in the bridge `config.yml`

```yaml
figma:
  publicUrl: https://example.com/hookshot/
  instances:
    your-instance:
      teamId: your-team-id
      accessToken: your-personal-access-token
      passcode: your-webhook-passcode
```

`your-instance` should be a friendly name for your instance E.g. `matrix-dot-org`.

The `publicUrl` value must be the **public** path to `/figma/webhook` on the webhooks listener. E.g. if your load balancer points `https://example.com/hookshot` to the bridge's webhooks listener, you should use the path `https://example.com/hookshot/figma/webhook`.

The `accessToken` should be the personal access token for your account.

The `passcode` should be a randomly generated code which is used to authenticate requests from Figma.

The bridge will automatically set up a webhook on Figma for you upon startup, and will automatically reconfigure that webhook if the `publicUrl` or `passcode` changes.

## Next steps

If you have followed these steps correctly, Figma should now be configured with hookshot 🥳.

To bridge a figma file into your room, you should:
  - Invite the bot user to the room.
  - Make sure the bot able to send state events (usually the Moderator power level in clients)
  - Say `!hookshot figma file fileUrl` where `fileUrl` is the URL to the figma file e.g `https://www.figma.com/files/project/12345/...`
  - Figma comments will now be bridged into the room.
