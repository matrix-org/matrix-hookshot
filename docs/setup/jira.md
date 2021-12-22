# JIRA

## Adding a webhook to a JIRA Organisation

This should be done for all JIRA organisations you wish to bridge. The steps may differ for SaaS and on-prem, but
you need to go to the `webhooks` configuration page under Settings > System.

Next, add a webhook that points to `/` on the public webhooks address for hookshot. You should also include a 
secret value by appending `?secret=your-webhook-secret`. The secret value can be anything, but should
be reasonably secure and should also be stored in the `config.yml` file.

Ensure that you enable all the events that you wish to be bridge.


## JIRA OAuth

<section class="notice">
The JIRA service currently only supports atlassian.com (JIRA SaaS) when handling user authentication.
Support for on-prem deployments is hoping to land soon.
</section>


You will need a Atlassain account with the ability to use the developer tools in order to create the app.

You'll first need to head to https://developer.atlassian.com/console/myapps/create-3lo-app/ to create a 
"OAuth 2.0 (3LO)" integration.

Once named and created, you will need to:
    - Enable the User REST, Jira Platform REST and User Identity APIs under Permissions.
    - Use rotating tokens under Authorisation.
    - Set a callback url. This will be the public URL to hookshot with a path of `/jira/oauth`.
    - Copy the client ID and Secret from Settings

## Configuration

You can now set some configuration in the bridge `config.yml`

```yaml
jira:
  webhook:
    secret: some-secret
  oauth:
    client_id: your-client-id
    client_secret: your-client-secret
    redirect_uri: https://example.com/hookshot/jira/oauth
```

You can leave the `oauth` section blank if you are not planning to use those capabilities.

The `redirect_uri` value must be the **public** path to `/jira/oauth` on the webhooks path. E.g. if your load balancer
points `https://example.com/hookshot` to the bridge's webhooks port, you should use the path `https://example.com/hookshot/jira/oauth`.
This value MUST exactly match the **Callback URL** on the JIRA integration page page.

## Next steps

If you have followed these steps correctly, JIRA should now be configured with hookshot 🥳.

You can now follow the guide on [authenticating with JIRA](../usage/auth.md#jira).
