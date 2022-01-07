# Contributing

Hey there, thanks for starting a contributing towards my project! 🎉.

Since this is more of a hobby project of mine rather than a serious paid endeavour, I cannot promise I will be able to 
get to each and every contribution in a timely manner but I aim to try and review every quality one that I can. With
that in mind, this file should hopefully help you to understand how to contribute useful PRs and Issues.

## Who can contribute

Everyone is welcome to contribute code to this project, provided that they are willing to license their contributions under the same license as the project itself.
We follow a simple 'inbound=outbound' model for contributions: the act of submitting an 'inbound' contribution means that the contributor agrees to license the code under the
same terms as the project's overall 'outbound' license - in our case, this Apache Software License v2 (see LICENSE).

## Contributing Issues (Filing bugs, feature requests)

Filing issues is simply done by creating an issue on https://github.com/matrix-org/synapse/issues.

We accept bug reports and feature requests, but please make it clear.

When filing bugs, please state:

- Your operating system / environment: E.g. Ubuntu Linux 20.04 with Docker
- The version (or commit hash / docker tag) you are running
- Your Matrix homeserver implementation and version: E.g. Synapse 1.50
- A rough idea of your config: E.g. Using GitLab and Figma support, with Redis support enabled.

## Pull requests

We don't require that all PRs contain tests, though adding tests to your code would improve it's credibility.

### Getting started

### Typescript v.s. Rust

The project was originally written in Typescript, but is gradually "oxidizing" into a Rust project. The eventual goal
is that most, if not all of the project is written in Rust but for the time being both languages are in active use.

We're accepting PRs in either language, so feel free to choose whatever is more familiar to you.

### Tests and CI

We have a modest but grown suite of tests written in Typescript under `/tests`. You can run these with
`yarn test`. At the moment the project is heavily weighted towards Typescript so tests are better off written
there, but any rust code featuring accompanying tests is welcome too. We have a few rules when writing tests:

- Use `expect` / `mocha` when writing tests, rather than relying on new dependencies (though exceptions may apply).
- Keep test names descriptive
  - i.e. `it("should correctly formats a issue room name")`
  - NOT `it("should succeed")`

Our CI will not run any actions by default (to avoid abuse), but reviewers will enable this for you once
its been reviewed by eye. We'd apprecaite it if contributors would do some local testing by running `yarn lint`
and `yarn test` before review, as it saves on round trips.

### Changelog

All changes, even minor ones, need a corresponding changelog / newsfragment
entry. These are managed by [Towncrier](https://github.com/hawkowl/towncrier).

To create a changelog entry, make a new file in the `changelog.d` directory named
in the format of `PRnumber.type`. The type can be one of the following:

* `feature`
* `bugfix`
* `doc` (for updates to the documentation)
* `removal` (also used for deprecations)
* `misc` (for internal-only changes)

This file will become part of our [changelog](
https://github.com/Half-Shot/matrix-hookshot/blob/main/CHANGELOG.md) at the next
release, so the content of the file should be a short description of your
change in the same style as the rest of the changelog. The file can contain Markdown
formatting, and should end with a full stop (.) or an exclamation mark (!) for
consistency.

Adding credits to the changelog is encouraged, we value your
contributions and would like to have you shouted out in the release notes!

For example, a fix in PR #1234 would have its changelog entry in
`changelog.d/1234.bugfix`, and contain content like:

> The security levels of Florbs are now validated when received
> via the `/federation/florb` endpoint. Contributed by Jane Matrix.

If there are multiple pull requests involved in a single bugfix/feature/etc,
then the content for each `changelog.d` file should be the same. Towncrier will
merge the matching files together into a single changelog entry when we come to
release.


## Additional support

If you have any questions, feel free to reach out to me on Matrix:
 - The project room [#hookshot:half-shot.uk](https://matrix.to/#/#hookshot:half-shot.uk)
 - or, via DM to [@Half-Shot:half-shot.uk](https://matrix.to/#/@Half-Shot:half-shot.uk)

Please note that we prefer the use of GitHub to file issues over Matrix chats, because it's easier
to track.

This file was adapted from https://matrix-org.github.io/synapse/latest/development/contributing_guide.html