# Releasing

Dependencies:

- [Towncrier](https://towncrier.readthedocs.io/en/stable/index.html)
- [Git tag PGP signing](https://git-scm.com/book/ms/v2/Git-Tools-Signing-Your-Work)

## Update versions

Update the `package.json` and `Cargo.toml` versions.

Run `cargo update matrix-hookshot` to update Cargo lock version.

Commit these three files.

## Run the release script

```bash
scripts/release.sh
```

## Publish the release

Go to the [releases page](https://github.com/matrix-org/matrix-hookshot/releases) and publish the release.
It may take a few minutes for the draft release to be created by CI.
