# Authenticating

To authenticate with services, you must first have a DM room with the bridge set up. In this guide,
we are going to assume the bot is called `@hookshot:example.com` but this will vary for your setup. For all
the instructions below, commands should only be executed in the DM room.

## GitHub

You can authenticate via OAuth or a Personal Access Token (PAT) when using GitHub. Authentication is required
when trying to bridge GitHub resources into rooms.

<section class="notice">
Please note that you will need a Personal Access Token in order to bridge your personal GitHub notifications.
This is a limitation of GitHub's API.
</section>


To authenticate with a personal access token:
1. Open [https://github.com/settings/tokens](https://github.com/settings/tokens) (Github > Settings > Developer Settings / Personal access tokens)
1. Click **Generate new token**
1. Give it a good name, and a sensible expiration date. For scopes you will need:
    - Repo (to access repo information)
      - If you want notifications for private repos, you need `repo: Full control of private repositories`. If you just want notifications for public repos, you only need:
        - repo:status
        - public_repo
    - Workflow (if you want to be able to launch workflows / GitHub actions from Matrix)
    - Notifications (if you want to bridge in your notifications to Matrix)
    - User
      - read:user
    - write:discussion (for GitHub discussion support)
      - read:discussion

1. Send the generated token to the bridge by saying `github setpersonaltoken %your-token%`. You can redact
  the message afterwards if you like.
1. The bridge will have connected you.

To authenticate via OAuth, you will need to have configured OAuth support in your config.yml, and have the endpoints required accessible from the internet.

- Say `github login` to get the URL to authenticate via.
- Click the URL sent by the bot.
- Follow the steps, ensuring you authenticate with the right user.
- If all goes well, you will now be connected.

You can check the status of authenticated instances by saying `github status`.

## GitLab

You can authenticate with GitLab by supplying a Personal Access Token. OAuth-style authentication isn't supported
yet.

- You will need to have configured a GitLab instance in your config.yml for the instance you want to log in to.
- Open **https://%instance%/-/profile/personal_access_tokens** (GitLab > User Settings > Access Tokens), where instance is your GitLab instance address.
  - For the public GitLab server, this would be "gitlab.com"
- Give it a good name, and a sensible expiration date. For scopes you will need to tick `api`.
- Send the generated token to the bridge by saying `gitlab personaltoken %instance% %your-token%`. You can redact
  the message afterwards if you like.
- The bridge will have connected you. You can check the status at any time by saying `gitlab hastoken %instance% `


## JIRA

You can log in to JIRA via OAuth. This means you will need to have configured OAuth support in your `config.yml`, and
have the endpoints required accessible from the internet. Authentication is required when trying to bridge JIRA resources into rooms.

- Say `jira login` to get the URL to authenticate via.
- Click the URL sent by the bot.
- Follow the steps, ensuring you authenticate with the right user.
- If all goes well, you will now be connected. You can check the status of authenticated instances by saying `jira whoami`
