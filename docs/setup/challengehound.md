# ChallengeHound

You can configure Hookshot to bridge [ChallengeHound](https://www.challengehound.com/) activites
into Matrix.

### Getting the API secret.

Unfortunately, there is no way to directly request a persistent Challenge Hound API token. The
only way to authenticate with the service at present is to login with an email address and receive
a magic token in an email. This is not something Hookshot has the capability to do on it's own.

In order to extract the token for use with the bridge, login to Challenge Hound. Once logged in,
please locate the local storage via the devtools of your browser. Inside you will find a `ch:user`
entry with a `token` value. That value should be used as the secret for your Hookshot config.

```yaml
challengeHound:
  token: <the token>
```

This token tends to expire roughly once a month, and for the moment you'll need to manually
replace it. You can also ask Challenge Hound's support for an API key, although this has not
been tested.

## Usage

You can add a new challenge hound challenge by command:

```
challengehound add https://www.challengehound.com/challenge/abc-def
```

and remove it with the same command

```
challengehound remove https://www.challengehound.com/challenge/abc-def
```.

Hookshot will periodically refetch activities from the challenge and send a notice when a new
one is completed. Note that Hookshot uses your configured cache to store seen activities. If
you have not configured Redis caching, it will default to in-memory storage which means activites
**will** repeat on restart.
