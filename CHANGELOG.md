1.0.0 (2021-12-21)
===================

This release is huge, containing not only a rename but many new features and bug fixes. To name some of the highlights:

- The bridge has now been renamed from `matrix-github` to `matrix-hookshot`.
- Now supports JIRA and Generic Webhooks in addition to GitHub and GitLab.
- Includes new commands and metrics reporting.
- Includes complete documentation.

As always, please contact me (@Half-Shot:half-shot.uk) if you require any help getting this setup and please report any bugs you encounter!

Features
--------

- The bridge now supports generic webhook bridging. ([\#77](https://github.com/half-shot/matrix-hookshot/issues/77))
- Add support for JIRA. ([\#82](https://github.com/half-shot/matrix-hookshot/issues/82))
- Add Provisioning API. Extra thanks to @turt2live for supporting this change. ([\#83](https://github.com/half-shot/matrix-hookshot/issues/83))
- GitHub support no longer needs an installation ID defined.
  Licence in package.json now accurately reflects `LICENCE`
  GitHub workflows can now be run with `!gh workflow run` on GitHubRepo connections. ([\#85](https://github.com/half-shot/matrix-hookshot/issues/85))
- Add `!hookshot` setup command for quickly setting up new rooms with the bridge. ([\#88](https://github.com/half-shot/matrix-hookshot/issues/88))
- Issues created with !gh create show the issue number inside a reaction.
  GitHubRepo connections can now optionally show a small diff for PRs.
  PRs can be reviewed by replying with a ✅ or a ❌ and a small text message. ([\#93](https://github.com/half-shot/matrix-hookshot/issues/93))
- Add support for `includingLabels`/`excludingLabels` state config for GitHubRepo and GitLab Repo connections, allowing rooms to recieve a subset of issue and PR/MR notifications based on labels. ([\#95](https://github.com/half-shot/matrix-hookshot/issues/95))
- Add automatic changelog generation via [Towncrier](https://github.com/twisted/towncrier). ([\#96](https://github.com/half-shot/matrix-hookshot/issues/96))
- Add support for exporting [Prometheus](https://prometheus.io) metrics. ([\#99](https://github.com/half-shot/matrix-hookshot/issues/99))
- Switch to using the `vm2` module for improved sandboxing of transformation functions ([\#101](https://github.com/half-shot/matrix-hookshot/issues/101))


Improved Documentation
----------------------

- Add documentation for most functionality in the bridge. ([\#90](https://github.com/half-shot/matrix-hookshot/issues/90))


Internal Changes
----------------

- The bridge now depends on Rust modules for some functionality. ([\#78](https://github.com/half-shot/matrix-hookshot/issues/78))
- The project has been renamed `matrix-hookshot`. ([\#81](https://github.com/half-shot/matrix-hookshot/issues/81))
- Use quotes instead of brackets in GH PRs. Thanks @Twi1ightSparkle! ([\#92](https://github.com/half-shot/matrix-hookshot/issues/92))
- Fix spelling of received. Thanks @andybalaam! ([\#94](https://github.com/half-shot/matrix-hookshot/issues/94))
- CI jobs now report the diff between the generated config and the in-tree sample config. ([\#97](https://github.com/half-shot/matrix-hookshot/issues/97))

0.1.0 (2021-04-21)
==================
This is the initial release of the GitHub bridge.
