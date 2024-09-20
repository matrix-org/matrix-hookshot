# ChallengeHound

You can configure Hookshot to bridge [ChallengeHound](https://www.challengehound.com/) activites
into Matrix.

### Getting the API secret.

You will need to email ChallengeHound support for an API token. They seem happy to provide one
as long as you are an admin of a challenge. See [this support article](https://support.challengehound.com/article/69-does-challenge-hound-have-an-api)

```yaml
challengeHound:
  token: <the token>
```

## Usage

You can add a new challenge hound challenge by command:

```
challengehound add https://www.challengehound.com/challenge/abc-def
```

and remove it with the same command

```
challengehound remove https://www.challengehound.com/challenge/abc-def
```

Hookshot will periodically refetch activities from the challenge and send a notice when a new
one is completed. Note that Hookshot uses your configured cache to store seen activities. If
you have not configured Redis caching, it will default to in-memory storage which means activites
**will** repeat on restart.
